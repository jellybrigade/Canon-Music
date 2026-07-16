import { useEffect, useState } from "react";
import { getDb } from "../db";
import { useArtistBrowseSessionStore } from "../store/artistBrowseSessionStore";
import type { ArtistRow } from "../types/library";
export type { ArtistRow } from "../types/library";

export function useArtists() {
  const refreshTick = useArtistBrowseSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<ArtistRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const db = await getDb();
      const rows = await db.select<ArtistRow[]>(`
        SELECT
          a.name,
          a.album_count,
          art.artwork_url,
          ai.lastfm_image_url,
          ai.wikidata_image_url,
          ai.navidrome_image_url
        FROM artists a
        LEFT JOIN artist_identity ai ON ai.artist_name = a.name
        LEFT JOIN (
          SELECT artist, server_id, artwork_url
          FROM albums
          WHERE artwork_url IS NOT NULL
          GROUP BY artist, server_id
        ) art ON art.artist = a.name AND art.server_id = a.server_id
        WHERE a.name NOT IN (SELECT alias_name FROM artist_aliases)
        ORDER BY a.name COLLATE NOCASE
      `);
      if (!cancelled) {
        setData(rows);
        setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return { data, isLoading };
}
