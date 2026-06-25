import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";

interface RecommendedAlbumRow {
  id: string;
  name: string;
  artist: string | null;
  year: number | null;
  artwork_url: string | null;
}

/**
 * Returns an album whose direct genres overlap >= 50% with the given album's genres.
 * Used by HomeView to populate the "Because you're listening to…" Spotlight slot.
 */
export function useRecommendedAlbum(albumId: string | null) {
  return useQuery({
    queryKey: QK.recommendedSpotlight(albumId),
    queryFn: async (): Promise<RecommendedAlbumRow | null> => {
      if (!albumId) return null;
      const db = await getDb();
      const rows = await db.select<RecommendedAlbumRow[]>(
        `SELECT a.id, a.name, a.artist, a.year, a.artwork_url,
                COUNT(*) AS genre_match,
                (SELECT COUNT(*) FROM album_genres WHERE album_id = a.id AND relation = 'direct') AS genre_total
         FROM album_genres ag
         JOIN albums a ON a.id = ag.album_id
         WHERE ag.canonical_id IN (
           SELECT canonical_id FROM album_genres WHERE album_id = ? AND relation = 'direct'
         )
         AND ag.relation = 'direct'
         AND ag.album_id != ?
         AND a.artwork_url IS NOT NULL
         GROUP BY ag.album_id
         HAVING genre_match * 1.0 / genre_total >= 0.5
         ORDER BY genre_match DESC, RANDOM()
         LIMIT 1`,
        [albumId, albumId]
      );
      return rows[0] ?? null;
    },
    enabled: !!albumId,
    staleTime: 5 * 60 * 1000,
  });
}
