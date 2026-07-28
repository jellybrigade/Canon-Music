import { useEffect } from "react";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { runPool } from "../lib/async-pool";
import { fetchArtistInfo } from "../lib/lastfm";
import { useSetting } from "./useSetting";
import { useTagsStore } from "../store/tags";

// Pacing note (rewritten 2026-07-28): there is deliberately no inter-item delay here.
// This loop used to sleep 2000ms between items, which on a cold library meant ~66 minutes
// of pure sleeping for 2000 albums. That delay was redundant: every network call this pass
// makes goes through Last.fm, and `src/lib/lastfm.ts` already funnels all of them through a
// single process-wide 250ms token bucket (<= 4 req/s). The rate limiter is the real throttle,
// so the wall clock is now bounded by the API budget instead of by a sleep on top of it.
//
// Concurrency exists only to overlap the local work (canon-tree scoring, ~10 SQLite
// round trips per album) with the rate limiter's waits; it does NOT raise the request rate,
// because the shared bucket still spaces every Last.fm call 250ms apart no matter how many
// workers are in flight. Kept low so background writes don't starve UI reads on the
// tauri-plugin-sql pool.
const POOL_CONCURRENCY = 3;
const AUTO_RUN_THRESHOLD = 300;

let isRunning = false;

type AlbumRow = { id: string; artist: string | null; name: string };
type ArtistRow = { name: string; lastfm_artist_name: string | null };

async function enrichArtistBackground(artistName: string, lastfmName: string): Promise<void> {
  const info = await fetchArtistInfo(lastfmName);
  const gotData = !!(info.bio || info.listeners || info.similar.length > 0);
  const db = await getDb();
  await db.execute(
    `INSERT INTO artist_identity
       (artist_name, mb_artist_id, lastfm_artist_name, confirmed_at,
        bio, listeners, playcount, similar_json, top_tags_json, lastfm_image_url, enriched_at)
     VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(artist_name) DO UPDATE SET
       bio = excluded.bio,
       listeners = excluded.listeners,
       playcount = excluded.playcount,
       similar_json = excluded.similar_json,
       top_tags_json = excluded.top_tags_json,
       lastfm_image_url = excluded.lastfm_image_url,
       enriched_at = CASE WHEN ? THEN excluded.enriched_at ELSE artist_identity.enriched_at END`,
    [
      artistName,
      info.bio,
      info.listeners,
      info.playcount,
      info.similar.length > 0 ? JSON.stringify(info.similar) : null,
      info.topTags.length > 0 ? JSON.stringify(info.topTags) : null,
      info.imageUrl,
      gotData ? Math.floor(Date.now() / 1000) : null,
      gotData ? 1 : 0,
    ]
  );
}

async function doEnrich(albums: AlbumRow[], artists: ArtistRow[], signal?: AbortSignal): Promise<void> {
  const { setPullProgress } = useTagsStore.getState();
  const total = albums.length + artists.length;
  if (total === 0) return;

  try {
    await runEnrichPasses(albums, artists, signal);
  } finally {
    // Covers abort and throw as well as normal completion: a progress bar left mounted at
    // "Fetching metadata... 431 / 2000" with no pass behind it never goes away on its own.
    setPullProgress(null);
  }
}

async function runEnrichPasses(albums: AlbumRow[], artists: ArtistRow[], signal?: AbortSignal): Promise<void> {
  const { setPullProgress } = useTagsStore.getState();
  const total = albums.length + artists.length;

  setPullProgress({ done: 0, total });
  let done = 0;
  // Both passes report into one combined progress bar, so the counter is shared rather
  // than taken from either pool's own per-pass count.
  const tick = () => setPullProgress({ done: ++done, total });

  await runPool(
    albums,
    async (album) => {
      try {
        await normalizeAlbum(album.id, album.artist ?? "", album.name);
      } catch (e) {
        console.warn("Background normalizer failed for:", album.name, e);
      }
      tick();
    },
    { concurrency: POOL_CONCURRENCY, signal },
  );
  if (signal?.aborted) return;

  await runPool(
    artists,
    async (artist) => {
      try {
        await enrichArtistBackground(artist.name, artist.lastfm_artist_name ?? artist.name);
      } catch (e) {
        console.warn("Background enricher failed for:", artist.name, e);
      }
      tick();
    },
    { concurrency: POOL_CONCURRENCY, signal },
  );
}

async function queryStale(staleDays: number): Promise<{ albums: AlbumRow[]; artists: ArtistRow[] }> {
  const db = await getDb();
  const albums = await db.select<AlbumRow[]>(
    `SELECT id, artist, name FROM albums
     WHERE computed_at IS NULL
        OR computed_at < unixepoch('now', '-' || ? || ' days')
     ORDER BY name`,
    [staleDays]
  );
  const artists = await db.select<ArtistRow[]>(
    `SELECT DISTINCT a.name,
            COALESCE(ai.lastfm_artist_name, a.name) AS lastfm_artist_name
     FROM artists a
     LEFT JOIN artist_identity ai ON ai.artist_name = a.name
     WHERE ai.enriched_at IS NULL
        OR ai.enriched_at < unixepoch('now', '-' || ? || ' days')
     ORDER BY a.name`,
    [staleDays]
  );
  return { albums, artists };
}

export function useBackgroundNormalizer() {
  const [autoRefresh] = useSetting("tags.auto_refresh", "true");
  const [stalenessDays] = useSetting("tags.staleness_days", "30");

  useEffect(() => {
    if (autoRefresh !== "true") return;
    if (isRunning) return;

    const staleDays = Number(stalenessDays) || 30;
    isRunning = true;

    async function checkStale() {
      const { setEnrichmentPending } = useTagsStore.getState();
      const { albums, artists } = await queryStale(staleDays);
      const total = albums.length + artists.length;

      if (total === 0) return;

      if (total > AUTO_RUN_THRESHOLD) {
        const snoozeDb = await getDb();
        const snoozeRows = await snoozeDb.select<{ value: string }[]>(
          "SELECT value FROM settings WHERE key = 'enrichment.snooze_until'", []
        );
        const snooze = snoozeRows[0]?.value;
        const snoozed = snooze === "forever"
          || (!!snooze && Number(snooze) > Math.floor(Date.now() / 1000));
        if (!snoozed) setEnrichmentPending(total);
        return;
      }

      await doEnrich(albums, artists);
    }

    // `isRunning` must be cleared on the throwing paths too. It was previously only reset on
    // the three success returns, so a failing `queryStale` (or a failed settings read) left
    // the flag latched true and killed the normalizer for the rest of the session.
    void checkStale()
      .catch((e) => console.warn("Background normalizer: stale check failed", e))
      .finally(() => { isRunning = false; });

    // Deliberately NO abort-on-cleanup here. StrictMode mounts this hook twice in dev, so
    // aborting the first pass on the intervening cleanup would leave the second mount
    // blocked by `isRunning` (still latched until the aborted pass settles) and no pass
    // would run at all. `doEnrich` takes an optional signal for callers that can supply one.
  }, [autoRefresh, stalenessDays]);
}

export async function runEnrichment(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  const { setEnrichmentPending } = useTagsStore.getState();
  setEnrichmentPending(null);
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = 'tags.staleness_days'",
      []
    );
    const staleDays = Number(rows[0]?.value) || 30;
    const { albums, artists } = await queryStale(staleDays);
    await doEnrich(albums, artists);
  } finally {
    isRunning = false;
  }
}
