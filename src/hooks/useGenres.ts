import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { useMemo } from "react";

export interface GenreRow {
  canonical_id: string;
  name: string;
  album_count: number;
}

export function useGenres() {
  return useQuery({
    queryKey: ["genres"],
    queryFn: async (): Promise<GenreRow[]> => {
      const db = await getDb();
      // Only show direct (leaf) canon-tree genres in the dropdown — raw: ids excluded.
      return db.select<GenreRow[]>(`
        SELECT canonical_id, name, COUNT(DISTINCT album_id) AS album_count
        FROM album_genres
        WHERE relation = 'direct'
          AND canonical_id NOT LIKE 'raw:%'
        GROUP BY canonical_id
        ORDER BY name COLLATE NOCASE
      `);
    },
  });
}

// Genres drawn from the user's most recently played albums (up to 10 albums).
// Falls back to empty array if no scrobble history exists.
export function useRecentGenres() {
  const query = useQuery({
    queryKey: ["genres", "recent"],
    queryFn: async (): Promise<GenreRow[]> => {
      const db = await getDb();
      return db.select<GenreRow[]>(`
        WITH recent_albums AS (
          SELECT t.album_id, MAX(sh.scrobbled_at) AS last_played
          FROM scrobble_history sh
          JOIN tracks t ON t.id = sh.track_id
          GROUP BY t.album_id
          ORDER BY last_played DESC
          LIMIT 10
        )
        SELECT ag.canonical_id, ag.name, COUNT(DISTINCT ag.album_id) AS album_count
        FROM recent_albums ra
        JOIN album_genres ag ON ag.album_id = ra.album_id
        WHERE ag.relation = 'direct'
          AND ag.canonical_id NOT LIKE 'raw:%'
        GROUP BY ag.canonical_id
        ORDER BY MAX(ra.last_played) DESC
      `);
    },
    staleTime: 5 * 60 * 1000,
  });

  const genres = useMemo(() => query.data ?? [], [query.data]);
  return { ...query, genres };
}
