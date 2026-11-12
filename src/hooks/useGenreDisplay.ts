import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDb } from "../db";
import { useCanonTreeNodes } from "../features/tags/hooks/useCanonTreeNodes";
import { QK } from "../lib/queryKeys";

const IGNORED = "__ignored__";
const ACCEPTED = "__accepted__";

interface MappingRow {
  raw_value: string;
  canonical_id: string;
}

/** Raw genre value to display name (null if ignored), absent if unmapped. */
export type GenreMappings = Map<string, string | null>;

/**
 * The mappings, or null when they couldn't be read, so callers show raw genres rather
 * than dropping every one as undecided. Built outside the query: a Map breaks structural sharing.
 */
export function useGenreMappings(): GenreMappings | null {
  const { data: rows = [], isError } = useQuery({
    queryKey: QK.genreDisplayMappings(),
    queryFn: async (): Promise<MappingRow[]> => {
      const db = await getDb();
      return db.select<MappingRow[]>("SELECT raw_value, canonical_id FROM tag_mappings WHERE kind = 'genre'");
    },
  });
  // An unreadable tree leaves display names as the raw values below.
  const { data: treeNodes } = useCanonTreeNodes();

  return useMemo(() => {
    if (isError) return null;
    const nodeById = new Map((treeNodes ?? []).map((n) => [n.id, n]));
    const map: GenreMappings = new Map();
    for (const row of rows) {
      if (row.canonical_id === IGNORED) {
        map.set(row.raw_value, null);
      } else if (row.canonical_id === ACCEPTED) {
        map.set(row.raw_value, row.raw_value);
      } else {
        const node = nodeById.get(row.canonical_id);
        map.set(row.raw_value, node?.name ?? row.raw_value);
      }
    }
    return map;
  }, [rows, treeNodes, isError]);
}

/** A raw genre's display name: undefined with no decision yet, null if ignored, as-is with no mappings readable. */
export function mappedGenreName(raw: string, mappings: GenreMappings | null): string | null | undefined {
  return mappings ? mappings.get(raw) : raw;
}

/**
 * Splits a raw genre string, applies mappings, de-dupes. Raw values with no mapping
 * decision yet are dropped, not shown as-is; with no mappings readable, all show as-is.
 */
export function applyGenreMappings(rawGenreString: string | null, mappings: GenreMappings | null): string[] {
  if (!rawGenreString) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawGenreString
    .split(/[,;]/)
    .map((g) => g.trim())
    .filter(Boolean)) {
    const mapped = mappedGenreName(raw, mappings);
    if (mapped == null) continue;
    if (!seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }
  return result;
}
