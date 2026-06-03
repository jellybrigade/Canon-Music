import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { fetchArtistInfo } from "../lib/lastfm";
import { useSetting } from "./useSetting";
import { useTagsStore } from "../store/tags";

const INTERVAL_MS = 2000;
const AUTO_RUN_THRESHOLD = 300;

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

async function doEnrich(albums: AlbumRow[], artists: ArtistRow[]): Promise<void> {
  const { setPullProgress } = useTagsStore.getState();
  const total = albums.length + artists.length;
  if (total === 0) return;

  setPullProgress({ done: 0, total });
  let done = 0;

  for (const album of albums) {
    try {
      await normalizeAlbum(album.id, album.artist ?? "", album.name);
    } catch (e) {
      console.warn("Background normalizer failed for:", album.name, e);
    }
    done++;
    setPullProgress({ done, total });
    await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
  }

  for (const artist of artists) {
    try {
      await enrichArtistBackground(artist.name, artist.lastfm_artist_name ?? artist.name);
    } catch (e) {
      console.warn("Background enricher failed for:", artist.name, e);
    }
    done++;
    setPullProgress({ done, total });
    await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
  }

  setPullProgress(null);
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
  const runningRef = useRef(false);

  useEffect(() => {
    if (autoRefresh !== "true") return;
    if (runningRef.current) return;

    const staleDays = Number(stalenessDays) || 30;
    runningRef.current = true;

    async function checkStale() {
      const { setEnrichmentPending } = useTagsStore.getState();
      const { albums, artists } = await queryStale(staleDays);
      const total = albums.length + artists.length;

      if (total === 0) {
        runningRef.current = false;
        return;
      }

      if (total > AUTO_RUN_THRESHOLD) {
        setEnrichmentPending(total);
        runningRef.current = false;
        return;
      }

      await doEnrich(albums, artists);
      runningRef.current = false;
    }

    void checkStale();
  }, [autoRefresh, stalenessDays]);
}

export async function runEnrichment(staleDays = 30): Promise<void> {
  const { setEnrichmentPending } = useTagsStore.getState();
  setEnrichmentPending(null);
  const { albums, artists } = await queryStale(staleDays);
  await doEnrich(albums, artists);
}
