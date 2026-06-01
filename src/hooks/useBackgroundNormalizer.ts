import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { fetchArtistInfo } from "../lib/lastfm";
import { useSetting } from "./useSetting";
import { useTagsStore } from "../store/tags";

const INTERVAL_MS = 2000;

async function enrichArtistBackground(artistName: string, lastfmName: string): Promise<void> {
  const info = await fetchArtistInfo(lastfmName);
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
       enriched_at = excluded.enriched_at`,
    [
      artistName,
      info.bio,
      info.listeners,
      info.playcount,
      info.similar.length > 0 ? JSON.stringify(info.similar) : null,
      info.topTags.length > 0 ? JSON.stringify(info.topTags) : null,
      info.imageUrl,
      Math.floor(Date.now() / 1000),
    ]
  );
}

export function useBackgroundNormalizer() {
  const [autoRefresh] = useSetting("tags.auto_refresh", "true");
  const [stalenessDays] = useSetting("tags.staleness_days", "30");
  const runningRef = useRef(false);

  useEffect(() => {
    if (autoRefresh !== "true") return;
    if (runningRef.current) return;

    const staleDays = Number(stalenessDays) || 30;
    let cancelled = false;
    runningRef.current = true;

    async function run() {
      const { setPullProgress } = useTagsStore.getState();
      const db = await getDb();

      type AlbumRow = { id: string; artist: string | null; name: string };
      const staleAlbums = await db.select<AlbumRow[]>(
        `SELECT id, artist, name FROM albums
         WHERE computed_at IS NULL
            OR computed_at < unixepoch('now', '-' || ? || ' days')
         ORDER BY name`,
        [staleDays]
      );

      type ArtistRow = { name: string; lastfm_artist_name: string | null };
      const staleArtists = await db.select<ArtistRow[]>(
        `SELECT DISTINCT a.name,
                COALESCE(ai.lastfm_artist_name, a.name) AS lastfm_artist_name
         FROM artists a
         LEFT JOIN artist_identity ai ON ai.artist_name = a.name
         WHERE ai.enriched_at IS NULL
            OR ai.enriched_at < unixepoch('now', '-' || ? || ' days')
         ORDER BY a.name`,
        [staleDays]
      );

      const total = staleAlbums.length + staleArtists.length;
      if (total === 0) {
        runningRef.current = false;
        return;
      }

      setPullProgress({ done: 0, total });
      let done = 0;

      for (const album of staleAlbums) {
        if (cancelled) break;
        try {
          await normalizeAlbum(album.id, album.artist ?? "", album.name);
        } catch (e) {
          console.warn("Background normalizer failed for:", album.name, e);
        }
        done++;
        if (!cancelled) {
          setPullProgress({ done, total });
          await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
        }
      }

      for (const artist of staleArtists) {
        if (cancelled) break;
        try {
          await enrichArtistBackground(artist.name, artist.lastfm_artist_name ?? artist.name);
        } catch (e) {
          console.warn("Background enricher failed for:", artist.name, e);
        }
        done++;
        if (!cancelled) {
          setPullProgress({ done, total });
          await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
        }
      }

      setPullProgress(null);
      runningRef.current = false;
    }

    void run();
    return () => { cancelled = true; };
  }, [autoRefresh, stalenessDays]);
}
