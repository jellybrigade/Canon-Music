import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";

export function useSimilarInLibrary(names: string[]) {
  return useQuery({
    queryKey: QK.similarInLibrary(names),
    queryFn: async () => {
      if (names.length === 0) return new Set<string>();
      const db = await getDb();
      const placeholders = names.map(() => "?").join(",");
      const rows = await db.select<{ name: string }[]>(
        `SELECT name FROM artists WHERE name IN (${placeholders})`,
        names
      );
      return new Set(rows.map((r) => r.name));
    },
    enabled: names.length > 0,
    staleTime: Infinity,
  });
}
