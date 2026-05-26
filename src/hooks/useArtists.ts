import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";

export interface ArtistRow {
  name: string;
  album_count: number;
  artwork_url: string | null;
}

export function useArtists() {
  return useQuery({
    queryKey: ["artists"],
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
          ) AS artwork_url
        FROM artists a
        ORDER BY a.name COLLATE NOCASE
      `);
    },
  });
}
