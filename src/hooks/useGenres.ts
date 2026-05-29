import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";

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
