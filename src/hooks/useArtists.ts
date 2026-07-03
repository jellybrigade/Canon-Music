import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import type { ArtistRow } from "../types/library";
export type { ArtistRow } from "../types/library";

export function useArtists() {
  return useQuery({
    queryKey: QK.artists(),
    queryFn: async (): Promise<ArtistRow[]> => {
      const db = await getDb();
      return db.select<ArtistRow[]>(`
        SELECT
          a.name,
          a.album_count,
          (
            SELECT al.artwork_url FROM albums al
            WHERE al.artist = a.name AND al.server_id = a.server_id AND al.artwork_url IS NOT NULL
            LIMIT 1
          ) AS artwork_url,
          ai.lastfm_image_url,
          ai.wikidata_image_url
        FROM artists a
        LEFT JOIN artist_identity ai ON ai.artist_name = a.name
        WHERE a.name NOT IN (SELECT alias_name FROM artist_aliases)
        ORDER BY a.name COLLATE NOCASE
      `);
    },
  });
}
