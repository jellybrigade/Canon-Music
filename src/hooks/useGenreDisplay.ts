import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import { getCanonTree } from "../lib/canonicalize";
import type { TreeNode } from "../lib/canonicalize";

const IGNORED = "__ignored__";
const ACCEPTED = "__accepted__";

interface MappingRow {
  raw_value: string;
  canonical_id: string;
}

/**
 * Returns a Map of raw genre value → display name (or null if ignored).
 * Unmapped raw values are absent from the map, show as-is.
 * Built outside React Query to avoid structuralSharing issues with Map.
 */
export function useGenreMappings(): Map<string, string | null> {
  const { data: rows = [] } = useQuery({
    queryKey: QK.genreDisplayMappings(),
    queryFn: async (): Promise<MappingRow[]> => {
      const db = await getDb();
      return db.select<MappingRow[]>(
        "SELECT raw_value, canonical_id FROM tag_mappings WHERE kind = 'genre'"
      );
    },
  });

  const [nodeById, setNodeById] = useState<Map<string, TreeNode>>(new Map());

  useEffect(() => {
    getCanonTree()
      .then((tree) => setNodeById(new Map(tree.nodes.map((n) => [n.id, n]))))
      .catch(console.error);
  }, []);

  return useMemo(() => {
    const map = new Map<string, string | null>();
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
  }, [rows, nodeById]);
}

/**
 * Splits a raw genre string, applies mappings, de-dupes.
 * Raw values with no mapping decision yet (unaccepted/unmapped) are dropped,
 * not shown as-is - only genres that went through accept/map/ignore surface here.
 * Returns ordered array of display genre names.
 */
export function applyGenreMappings(
  rawGenreString: string | null,
  mappings: Map<string, string | null>
): string[] {
  if (!rawGenreString) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawGenreString.split(/[,;]/).map((g) => g.trim()).filter(Boolean)) {
    if (!mappings.has(raw)) continue;
    const mapped = mappings.get(raw) ?? null;
    if (mapped === null) continue;
    if (!seen.has(mapped)) { seen.add(mapped); result.push(mapped); }
  }
  return result;
}
