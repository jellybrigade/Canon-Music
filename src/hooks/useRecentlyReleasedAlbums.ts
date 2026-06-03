import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import type { AlbumRow } from "./useAlbums";

export function useRecentlyReleasedAlbums(limit = 20) {
  return useQuery<AlbumRow[]>({
    queryKey: ["recently-released", limit],
    queryFn: async () => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url
         FROM albums
         WHERE year IS NOT NULL
         ORDER BY year DESC, name
         LIMIT ?`,
        [limit]
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}
