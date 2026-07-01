import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";

// One representative (most recent) album per similar-in-library artist.
export function useSimilarArtistAlbums(artistNames: string[]) {
  return useQuery({
    queryKey: QK.similarArtistAlbums(artistNames),
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      const placeholders = artistNames.map(() => "?").join(",");
      const rows = await db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type
         FROM albums
         WHERE artist IN (${placeholders})
            OR artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name IN (${placeholders}))
         ORDER BY artist, year IS NULL, year DESC`,
        [...artistNames, ...artistNames]
      );
      const seenArtists = new Set<string>();
      const picked: AlbumRow[] = [];
      for (const row of rows) {
        if (!row.artist || seenArtists.has(row.artist)) continue;
        seenArtists.add(row.artist);
        picked.push(row);
      }
      return picked;
    },
    enabled: artistNames.length > 0,
  });
}
