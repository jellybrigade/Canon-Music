import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import type { AlbumRow } from "./useAlbums";

export interface GenreRow {
  name: string;
  album_count: number;
  track_count: number;
}

export function useGenres() {
  return useQuery({
    queryKey: ["genres"],
    queryFn: async (): Promise<GenreRow[]> => {
      const db = await getDb();
      return db.select<GenreRow[]>(`
        SELECT
          genre AS name,
          COUNT(DISTINCT album_id) AS album_count,
          COUNT(*) AS track_count
        FROM tracks
        WHERE genre IS NOT NULL AND genre != ''
        GROUP BY genre
        ORDER BY genre COLLATE NOCASE
      `);
    },
  });
}

export function useAlbumsByGenre(genre: string | null) {
  return useQuery({
    queryKey: ["albums-by-genre", genre],
    enabled: genre != null,
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url
         FROM albums a
         JOIN tracks t ON t.album_id = a.id
         WHERE t.genre = ?
         ORDER BY a.artist, a.name`,
        [genre]
      );
    },
  });
}
