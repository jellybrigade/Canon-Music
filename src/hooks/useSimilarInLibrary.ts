import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";

export function useSimilarInLibrary(names: string[]) {
  const query = useQuery({
    queryKey: QK.similarInLibrary(names),
    queryFn: async (): Promise<string[]> => {
      if (names.length === 0) return [];
      const db = await getDb();
      const placeholders = names.map(() => "?").join(",");
      const rows = await db.select<{ name: string }[]>(
        `SELECT name FROM artists WHERE name IN (${placeholders})`,
        names
      );
      return rows.map((r) => r.name);
    },
    enabled: names.length > 0,
    staleTime: Infinity,
  });

  const set = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { ...query, data: set };
}
