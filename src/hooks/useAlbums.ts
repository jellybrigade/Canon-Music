import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import type { AlbumRow, AlbumSort } from "../types/library";
export type { AlbumRow, AlbumSort } from "../types/library";

const ORDER_BY: Record<AlbumSort, string> = {
  artist: "a.artist COLLATE NOCASE, a.name COLLATE NOCASE",
  alphabetical: "a.name COLLATE NOCASE",
  year: "a.year DESC, a.name COLLATE NOCASE",
  recently_added: "COALESCE(a.navidrome_created, a.created_at) DESC",
};

export function useAlbums(sort: AlbumSort = "artist", canonicalIds: string[] = []) {
  return useQuery({
    queryKey: QK.albums(sort, canonicalIds),
    queryFn: async () => {
      const db = await getDb();
      const order = ORDER_BY[sort];
      if (canonicalIds.length > 0) {
        const placeholders = canonicalIds.map(() => "?").join(", ");
        // Join through album_genres — covers both leaf and ancestor canon ids,
        // as well as raw: synthetic ids for unmatched tags.
        return db.select<AlbumRow[]>(
          `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type
           FROM albums a
           JOIN album_genres ag ON ag.album_id = a.id
           WHERE ag.canonical_id IN (${placeholders})
           ORDER BY ${order}`,
          canonicalIds
        );
      }
      return db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type, accent_color FROM albums a ORDER BY ${order}`
      );
    },
  });
}
