import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";

/** Last.fm's spelling of an artist rarely matches the local one byte for byte
 * ("Tyler, The Creator" vs "Tyler, the Creator"), so ownership is decided on a
 * case- and whitespace-insensitive key rather than on the raw string. */
function ownershipKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Returns the subset of `names`, in their original Last.fm spelling, that the
 * local library owns - either under that name or under an alias pointing at a
 * canonical artist, since a merged artist is still in the library. */
export function useSimilarInLibrary(names: string[]) {
  const query = useQuery({
    queryKey: QK.similarInLibrary(names),
    queryFn: async (): Promise<string[]> => {
      if (names.length === 0) return [];
      const db = await getDb();
      const placeholders = names.map(() => "?").join(",");
      const keys = names.map(ownershipKey);
      const rows = await db.select<{ name: string }[]>(
        `SELECT name FROM artists WHERE LOWER(TRIM(name)) IN (${placeholders})
         UNION
         SELECT alias_name AS name FROM artist_aliases WHERE LOWER(TRIM(alias_name)) IN (${placeholders})`,
        [...keys, ...keys]
      );
      const owned = new Set(rows.map((r) => ownershipKey(r.name)));
      // Returning the caller's own spelling, so the consumer's `set.has(name)`
      // lookup stays a plain exact match against the list it passed in.
      return names.filter((n) => owned.has(ownershipKey(n)));
    },
    enabled: names.length > 0,
    staleTime: Infinity,
  });

  const set = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { ...query, data: set };
}
