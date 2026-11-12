import { useCallback, useEffect, useState } from "react";
import { getDb } from "../../../db";
import { errorMessage } from "../../../lib/errorMessage";
import type { NodeSection, TreeNode } from "../lib/canonicalize";
import { getCanonTree } from "../lib/canonicalize";

export interface GenreTreeData {
  nodeById: Map<string, TreeNode>;
  childrenById: Map<string, string[]>;
  countById: Map<string, number>;
  // Per section: node ids with no parent that both has albums and is listed in that section
  rootsBySection: Record<NodeSection, string[]>;
}

// One server's tree at a time, the one the library views show.
let cached: { serverId: string; data: GenreTreeData } | null = null;

export function sectionRoots(liveNodes: TreeNode[]): Record<NodeSection, string[]> {
  const sectionsById = new Map(liveNodes.map((n) => [n.id, n.sections]));
  const sorted = [...liveNodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const rootsOf = (section: NodeSection) =>
    sorted
      .filter((n) => n.sections.includes(section) && n.parents.every((p) => !sectionsById.get(p)?.includes(section)))
      .map((n) => n.id);
  return {
    genres: rootsOf("genres"),
    descriptors: rootsOf("descriptors"),
    "scenes-and-movements": rootsOf("scenes-and-movements"),
  };
}

export function invalidateGenreTreeCache(): void {
  cached = null;
}

async function buildGenreTree(serverId: string): Promise<GenreTreeData> {
  if (cached?.serverId === serverId) return cached.data;

  const [tree, db] = await Promise.all([getCanonTree(), getDb()]);

  type CountRow = { canonical_id: string; album_count: number };
  const countRows = await db.select<CountRow[]>(
    `SELECT ag.canonical_id, COUNT(DISTINCT ag.album_id) AS album_count
     FROM album_genres ag
     JOIN albums a ON a.id = ag.album_id
     WHERE a.server_id = ?
     GROUP BY ag.canonical_id`,
    [serverId],
  );

  const countById = new Map<string, number>();
  for (const row of countRows) {
    countById.set(row.canonical_id, row.album_count);
  }

  // Only keep nodes with at least 1 album
  const liveNodes = tree.nodes.filter((n) => (countById.get(n.id) ?? 0) > 0);
  const liveIds = new Set(liveNodes.map((n) => n.id));

  const nodeById = new Map<string, TreeNode>();
  for (const n of liveNodes) nodeById.set(n.id, n);

  // Build children map (from parents[] in each node)
  const childrenById = new Map<string, string[]>();
  for (const n of liveNodes) {
    for (const parentId of n.parents) {
      if (!liveIds.has(parentId)) continue;
      const list = childrenById.get(parentId) ?? [];
      if (!list.includes(n.id)) list.push(n.id);
      childrenById.set(parentId, list);
    }
  }

  // Sort children alphabetically by name
  for (const [, children] of childrenById) {
    children.sort((a, b) => {
      const na = nodeById.get(a)?.name ?? "";
      const nb = nodeById.get(b)?.name ?? "";
      return na.localeCompare(nb, undefined, { sensitivity: "base" });
    });
  }

  const rootsBySection = sectionRoots(liveNodes);

  const data = { nodeById, childrenById, countById, rootsBySection };
  cached = { serverId, data };
  return data;
}

export function useGenreTree(serverId: string | undefined): {
  data: GenreTreeData | null;
  error: string | null;
  retry: () => void;
} {
  const [result, setResult] = useState<{ serverId: string; data: GenreTreeData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    buildGenreTree(serverId)
      .then((d) => {
        if (!cancelled) setResult({ serverId, data: d });
      })
      .catch((err: unknown) => {
        console.error("useGenreTree: failed to build genre tree", err);
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { data: result && result.serverId === serverId ? result.data : null, error, retry };
}
