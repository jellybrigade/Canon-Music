import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";

export interface AlbumRow {
  id: string;
  server_id: string;
  name: string;
  artist: string | null;
  year: number | null;
  artwork_url: string | null;
}

export type AlbumSort = "artist" | "alphabetical" | "year" | "recently_added";

const ORDER_BY: Record<AlbumSort, string> = {
  artist: "a.artist COLLATE NOCASE, a.name COLLATE NOCASE",
  alphabetical: "a.name COLLATE NOCASE",
  year: "a.year DESC, a.name COLLATE NOCASE",
  recently_added: "COALESCE(a.navidrome_created, a.created_at) DESC",
};

export function useAlbums(sort: AlbumSort = "artist", genres: string[] = [], canonicalIds: string[] = []) {
  return useQuery({
    queryKey: ["albums", sort, genres, canonicalIds],
    queryFn: async () => {
      const db = await getDb();
      const order = ORDER_BY[sort];
      if (canonicalIds.length > 0) {
        const placeholders = canonicalIds.map(() => "?").join(", ");
        return db.select<AlbumRow[]>(
          `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url
           FROM albums a
           JOIN tracks t ON t.album_id = a.id
           JOIN track_tags tt ON tt.track_id = t.id
           WHERE tt.canonical_id IN (${placeholders})
           ORDER BY ${order}`,
          canonicalIds
        );
      }
      if (genres.length === 0) {
        return db.select<AlbumRow[]>(
          `SELECT id, server_id, name, artist, year, artwork_url FROM albums a ORDER BY ${order}`
        );
      }
      const placeholders = genres.map(() => "?").join(", ");
      return db.select<AlbumRow[]>(
        `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url
         FROM albums a
         JOIN tracks t ON t.album_id = a.id
         WHERE t.genre IN (${placeholders})
         ORDER BY ${order}`,
        genres
      );
    },
  });
}
