import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";
import { QK } from "../lib/queryKeys";
import { HOME_GC_TIME, HOME_STALE_TIME } from "../lib/homeQueryTiming";

export function useRecentlyReleasedAlbums(limit = 20) {
  return useQuery<AlbumRow[]>({
    queryKey: QK.recentlyReleased(limit),
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
    staleTime: HOME_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
}
