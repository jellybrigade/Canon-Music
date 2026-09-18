import { useEffect, useState } from "react";
import { getDb } from "../db";
import { getCanonTree } from "../lib/canonicalize";
import type { TreeNode, NodeSection } from "../lib/canonicalize";

export interface GenreTreeData {
  nodeById: Map<string, TreeNode>;
  childrenById: Map<string, string[]>;
  countById: Map<string, number>;
  // Per section: node ids with no parent that both has albums and is listed in that section
  rootsBySection: Record<NodeSection, string[]>;
}

let cachedData: GenreTreeData | null = null;

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
  cachedData = null;
}

async function buildGenreTree(): Promise<GenreTreeData> {
  if (cachedData) return cachedData;

  const [tree, db] = await Promise.all([getCanonTree(), getDb()]);

  type CountRow = { canonical_id: string; album_count: number };
  const countRows = await db.select<CountRow[]>(
    `SELECT canonical_id, COUNT(DISTINCT album_id) AS album_count
     FROM album_genres
     GROUP BY canonical_id`
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

  cachedData = { nodeById, childrenById, countById, rootsBySection };
  return cachedData;
}

export function useGenreTree(): GenreTreeData | null {
  const [data, setData] = useState<GenreTreeData | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildGenreTree()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, []);

  return data;
}
