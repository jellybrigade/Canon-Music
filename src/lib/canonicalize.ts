import canonTreeData from "../assets/canon-tree.json";
import { getDb } from "../db";

export type TagKind = "genre" | "mood";
export type MatchType = "exact" | "fuzzy" | "mapping" | "cross-type" | "none";

export type NodeSection = "genres" | "descriptors" | "scenes-and-movements";

export interface TreeNode {
  id: string;
  name: string;
  type: string;
  canonical_key: string;
  parents: string[];
  section?: NodeSection;
}

export interface CanonTree {
  nodes: TreeNode[];
  byKey: Map<string, TreeNode>;
  byId: Map<string, TreeNode>;
}

export interface FindResult {
  node: TreeNode | null;
  matchType: MatchType;
}

let cachedTree: CanonTree | null = null;

export function bustCanonTreeCache(): void {
  cachedTree = null;
}

export async function getCanonTree(): Promise<CanonTree> {
  if (cachedTree) return cachedTree;

  const db = await getDb();
  type UserNode = { id: string; name: string; type: string; canonical_key: string; parent_ids: string };
  const userRows = await db.select<UserNode[]>("SELECT * FROM user_tree_nodes");

  const bundled = canonTreeData.nodes as TreeNode[];
  const userNodes: TreeNode[] = userRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    canonical_key: r.canonical_key,
    parents: JSON.parse(r.parent_ids) as string[],
  }));

  const nodes = [...bundled, ...userNodes];
  const byKey = new Map<string, TreeNode>();
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) {
    byKey.set(n.canonical_key, n);
    byId.set(n.id, n);
  }

  cachedTree = { nodes, byKey, byId };
  return cachedTree;
}

export function canonicalKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalization that matches the SQL in tag_vocab_cache (used as JOIN key in tag_mappings). */
export function sqlNorm(name: string): string {
  return name.replace(/-/g, " ").replace(/_/g, " ").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Synthetic canonical_id for unmatched tags stored in album_genres. */
export function rawGenreId(tagName: string): string {
  return `raw:${canonicalKey(tagName)}`;
}

function levenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i) as number[];
  const curr = Array.from({ length: b.length + 1 }, () => 0) as number[];
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > maxDist) return maxDist + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

export function getParentChain(node: TreeNode, byId: Map<string, TreeNode>, maxDepth = 4): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current = node;
  while (current.parents.length > 0 && chain.length < maxDepth) {
    const parentId = current.parents[0]!;
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent.name);
    current = parent;
  }
  return chain;
}

/**
 * BFS over all parent edges in the DAG, returning every ancestor id of `node`
 * (not including `node.id` itself). Cycle-safe.
 */
export function getAncestorIds(node: TreeNode, byId: Map<string, TreeNode>): string[] {
  const visited = new Set<string>([node.id]);
  const queue: string[] = [...node.parents];
  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    const parent = byId.get(id);
    if (parent) {
      for (const pid of parent.parents) {
        if (!visited.has(pid)) queue.push(pid);
      }
    }
  }
  return result;
}

export async function findCanonical(
  rawValue: string,
  kind: TagKind,
  existingMappings?: Map<string, string>
): Promise<FindResult> {
  const tree = await getCanonTree();
  const key = canonicalKey(rawValue);

  // Check saved mapping first
  if (existingMappings) {
    const mappedId = existingMappings.get(`${rawValue}:${kind}`);
    if (mappedId) {
      const node = tree.byId.get(mappedId) ?? null;
      return { node, matchType: "mapping" };
    }
  }

  const kindNodes = tree.nodes.filter((n) => n.type === kind);

  // Exact canonical_key match
  const exact = kindNodes.find((n) => n.canonical_key === key);
  if (exact) return { node: exact, matchType: "exact" };

  // Cross-type exact match (e.g. server genre "Lo-Fi" matching mood-typed descriptor node)
  const crossType = tree.nodes.find((n) => n.canonical_key === key);
  if (crossType) return { node: crossType, matchType: "cross-type" };

  // Fuzzy Levenshtein ≤ 2 (skip short strings to avoid false positives)
  if (key.length >= 5) {
    let bestNode: TreeNode | null = null;
    let bestDist = 3;
    for (const node of kindNodes) {
      const dist = levenshtein(key, node.canonical_key, 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestNode = node;
      }
    }
    if (bestNode) {
      return { node: bestNode, matchType: "fuzzy" };
    }
  }

  return { node: null, matchType: "none" };
}

export function findCanonicalSync(
  rawValue: string,
  kind: TagKind,
  tree: CanonTree,
  existingMappings?: Map<string, string>
): FindResult {
  const key = canonicalKey(rawValue);

  if (existingMappings) {
    const mappedId = existingMappings.get(`${rawValue}:${kind}`);
    if (mappedId) {
      const node = tree.byId.get(mappedId) ?? null;
      return { node, matchType: "mapping" };
    }
  }

  const kindNodes = tree.nodes.filter((n) => n.type === kind);

  const exact = kindNodes.find((n) => n.canonical_key === key);
  if (exact) return { node: exact, matchType: "exact" };

  // Cross-type exact match (e.g. server genre "Lo-Fi" matching mood-typed descriptor node)
  const crossType = tree.nodes.find((n) => n.canonical_key === key);
  if (crossType) return { node: crossType, matchType: "cross-type" };

  if (key.length >= 5) {
    let bestNode: TreeNode | null = null;
    let bestDist = 3;
    for (const node of kindNodes) {
      const dist = levenshtein(key, node.canonical_key, 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestNode = node;
      }
    }
    if (bestNode) {
      return { node: bestNode, matchType: "fuzzy" };
    }
  }

  return { node: null, matchType: "none" };
}
