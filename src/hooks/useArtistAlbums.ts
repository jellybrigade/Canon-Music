import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";

export function useArtistAlbums(artistName: string) {
  return useQuery({
    queryKey: QK.artistAlbums(artistName),
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type
         FROM albums
         WHERE artist = ?
            OR artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY year IS NULL, year DESC, name`,
        [artistName, artistName]
      );
    },
    enabled: !!artistName,
  });
}
