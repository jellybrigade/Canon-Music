import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";

// One representative (most recent) album per similar-in-library artist,
// ordered to match the caller's artistNames ranking (Last.fm similarity),
// not alphabetically, callers may truncate the result and expect the
// most-similar artists to survive the cut.
export function useSimilarArtistAlbums(artistNames: string[], serverId: string) {
  return useQuery({
    queryKey: QK.similarArtistAlbums(artistNames, serverId),
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      const placeholders = artistNames.map(() => "?").join(",");
      const rows = await db.select<(AlbumRow & { match_name: string })[]>(
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type,
                COALESCE(al.canonical_name, a.artist) AS match_name
         FROM albums a
         LEFT JOIN artist_aliases al ON al.alias_name = a.artist
         WHERE a.server_id = ?
           AND (a.artist IN (${placeholders})
            OR a.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name IN (${placeholders})))
         ORDER BY a.artist, a.year IS NULL, a.year DESC`,
        [serverId, ...artistNames, ...artistNames]
      );
      const rank = new Map(artistNames.map((name, i) => [name, i]));
      const seenArtists = new Set<string>();
      const picked: (AlbumRow & { match_name: string })[] = [];
      for (const row of rows) {
        if (!row.artist || seenArtists.has(row.artist)) continue;
        seenArtists.add(row.artist);
        picked.push(row);
      }
      picked.sort((a, b) => (rank.get(a.match_name) ?? Infinity) - (rank.get(b.match_name) ?? Infinity));
      return picked.map(({ match_name, ...album }) => album);
    },
    enabled: artistNames.length > 0,
  });
}
