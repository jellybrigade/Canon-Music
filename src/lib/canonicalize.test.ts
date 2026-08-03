import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bustCanonTreeCache,
  canonicalKey,
  findCanonicalSync,
  getAncestorIds,
  getParentChain,
  rawGenreId,
  sqlNorm,
  type CanonTree,
  type TreeNode,
} from "./canonicalize";

function node(over: Partial<TreeNode> & { id: string; name: string }): TreeNode {
  return {
    type: "genre",
    canonical_key: canonicalKey(over.name),
    parents: [],
    ...over,
  };
}

function buildTree(nodes: TreeNode[]): CanonTree {
  const byKey = new Map<string, TreeNode>();
  const byId = new Map<string, TreeNode>();
  const nodesByKind = new Map<string, TreeNode[]>();
  const byKindAndKey = new Map<string, Map<string, TreeNode>>();
  for (const n of nodes) {
    if (!byKey.has(n.canonical_key)) byKey.set(n.canonical_key, n);
    byId.set(n.id, n);
    let kindList = nodesByKind.get(n.type);
    if (!kindList) {
      kindList = [];
      nodesByKind.set(n.type, kindList);
    }
    kindList.push(n);
    let kindKeyMap = byKindAndKey.get(n.type);
    if (!kindKeyMap) {
      kindKeyMap = new Map();
      byKindAndKey.set(n.type, kindKeyMap);
    }
    if (!kindKeyMap.has(n.canonical_key)) kindKeyMap.set(n.canonical_key, n);
  }
  return { nodes, byKey, byId, nodesByKind, byKindAndKey };
}

describe("canonicalKey", () => {
  it("lowercases and collapses whitespace", () => {
    expect(canonicalKey("  Hip   Hop  ")).toBe("hip hop");
  });

  it("strips punctuation", () => {
    expect(canonicalKey("Lo-Fi!")).toBe("lofi");
  });

  it("strips diacritics", () => {
    expect(canonicalKey("Sigur Rós")).toBe("sigur ros");
  });

  it("normalizes & to and", () => {
    expect(canonicalKey("R&B")).toBe("r and b");
  });

  it("returns empty string for empty input", () => {
    expect(canonicalKey("")).toBe("");
  });
});

describe("sqlNorm", () => {
  it("replaces hyphens and underscores with spaces and lowercases", () => {
    expect(sqlNorm("Post-Rock_Fusion")).toBe("post rock fusion");
  });

  it("trims surrounding whitespace", () => {
    expect(sqlNorm("  Ambient  ")).toBe("ambient");
  });
});

describe("rawGenreId", () => {
  it("prefixes the canonical key with raw:", () => {
    expect(rawGenreId("Lo-Fi!")).toBe("raw:lofi");
  });

  it("is stable across equivalent inputs", () => {
    expect(rawGenreId("Hip Hop")).toBe(rawGenreId("  hip   hop  "));
  });
});

describe("getParentChain", () => {
  it("walks single-parent chain from root to node's immediate parent", () => {
    const grandparent = node({ id: "gp", name: "Root" });
    const parent = node({ id: "p", name: "Mid", parents: ["gp"] });
    const child = node({ id: "c", name: "Leaf", parents: ["p"] });
    const byId = new Map([
      ["gp", grandparent],
      ["p", parent],
      ["c", child],
    ]);
    expect(getParentChain(child, byId)).toEqual(["Root", "Mid"]);
  });

  it("respects maxDepth", () => {
    const a = node({ id: "a", name: "A" });
    const b = node({ id: "b", name: "B", parents: ["a"] });
    const c = node({ id: "c", name: "C", parents: ["b"] });
    const d = node({ id: "d", name: "D", parents: ["c"] });
    const byId = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
      ["d", d],
    ]);
    expect(getParentChain(d, byId, 2)).toEqual(["B", "C"]);
  });

  it("terminates on a cycle instead of hanging", () => {
    const a = node({ id: "a", name: "A", parents: ["b"] });
    const b = node({ id: "b", name: "B", parents: ["a"] });
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(getParentChain(a, byId)).toEqual(["A", "B"]);
  });

  it("returns empty array for a root node", () => {
    const root = node({ id: "root", name: "Root" });
    expect(getParentChain(root, new Map([["root", root]]))).toEqual([]);
  });
});

describe("getAncestorIds", () => {
  it("returns the union of ancestors across multiple parents, deduped", () => {
    // Diamond: child -> {p1, p2} -> shared grandparent
    const grandparent = node({ id: "gp", name: "GP" });
    const p1 = node({ id: "p1", name: "P1", parents: ["gp"] });
    const p2 = node({ id: "p2", name: "P2", parents: ["gp"] });
    const child = node({ id: "child", name: "Child", parents: ["p1", "p2"] });
    const byId = new Map([
      ["gp", grandparent],
      ["p1", p1],
      ["p2", p2],
      ["child", child],
    ]);
    const ancestors = getAncestorIds(child, byId);
    expect(ancestors.sort()).toEqual(["gp", "p1", "p2"]);
  });

  it("does not include the node itself", () => {
    const solo = node({ id: "solo", name: "Solo" });
    expect(getAncestorIds(solo, new Map([["solo", solo]]))).toEqual([]);
  });

  it("is cycle-safe", () => {
    const a = node({ id: "a", name: "A", parents: ["b"] });
    const b = node({ id: "b", name: "B", parents: ["a"] });
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(getAncestorIds(a, byId)).toEqual(["b"]);
  });
});

describe("findCanonicalSync", () => {
  it("matches exact canonical_key within the same kind", () => {
    const hipHop = node({ id: "hh", name: "Hip Hop" });
    const tree = buildTree([hipHop]);
    const result = findCanonicalSync("Hip Hop", "genre", tree);
    expect(result).toEqual({ node: hipHop, matchType: "exact" });
  });

  it("prefers a saved mapping over an exact key match", () => {
    const hipHop = node({ id: "hh", name: "Hip Hop" });
    const other = node({ id: "other", name: "Something Else" });
    const tree = buildTree([hipHop, other]);
    const mappings = new Map([["Hip Hop:genre", "other"]]);
    const result = findCanonicalSync("Hip Hop", "genre", tree, mappings);
    expect(result).toEqual({ node: other, matchType: "mapping" });
  });

  it("falls back to cross-type match when no same-kind node exists", () => {
    const lofi = node({ id: "lofi", name: "Lo-Fi", type: "mood" });
    const tree = buildTree([lofi]);
    const result = findCanonicalSync("Lo-Fi", "genre", tree);
    expect(result).toEqual({ node: lofi, matchType: "cross-type" });
  });

  it("falls back to fuzzy match within Levenshtein distance 2", () => {
    const synthwave = node({ id: "sw", name: "Synthwave" });
    const tree = buildTree([synthwave]);
    const result = findCanonicalSync("Synthwav", "genre", tree);
    expect(result).toEqual({ node: synthwave, matchType: "fuzzy" });
  });

  it("does not fuzzy match short strings", () => {
    const pop = node({ id: "pop", name: "Pop" });
    const tree = buildTree([pop]);
    const result = findCanonicalSync("Pob", "genre", tree);
    expect(result).toEqual({ node: null, matchType: "none" });
  });

  it("returns none when nothing matches", () => {
    const tree = buildTree([node({ id: "x", name: "Completely Unrelated Thing" })]);
    const result = findCanonicalSync("zzz", "genre", tree);
    expect(result).toEqual({ node: null, matchType: "none" });
  });

  it("resolves a mapping to null when the mapped id no longer exists in the tree", () => {
    const tree = buildTree([node({ id: "hh", name: "Hip Hop" })]);
    const mappings = new Map([["Old Tag:genre", "deleted-id"]]);
    const result = findCanonicalSync("Old Tag", "genre", tree, mappings);
    expect(result).toEqual({ node: null, matchType: "mapping" });
  });
});

describe("bustCanonTreeCache", () => {
  beforeEach(() => {
    vi.resetModules();
    bustCanonTreeCache();
  });

  it("forces the next getCanonTree call to re-read from the db", async () => {
    const select = vi.fn(async () => [] as unknown[]);
    vi.doMock("../db", () => ({ getDb: async () => ({ select }) }));
    const { getCanonTree: freshGetCanonTree, bustCanonTreeCache: freshBust } = await import(
      "./canonicalize"
    );

    await freshGetCanonTree();
    await freshGetCanonTree();
    expect(select).toHaveBeenCalledTimes(1);

    freshBust();
    await freshGetCanonTree();
    expect(select).toHaveBeenCalledTimes(2);
  });
});

describe("getCanonTree (bundled data smoke)", () => {
  it("loads the real bundled tree without a db round trip failing the whole app", async () => {
    // Smoke-level only: assert the bundled tree is non-empty and self-consistent,
    // not exhaustive correctness of canon-tree.json's contents.
    vi.resetModules();
    vi.doMock("../db", () => ({ getDb: async () => ({ select: async () => [] }) }));
    const { getCanonTree: freshGetCanonTree } = await import("./canonicalize");
    const tree = await freshGetCanonTree();
    expect(tree.nodes.length).toBeGreaterThan(0);
    for (const n of tree.nodes) {
      expect(tree.byId.get(n.id)).toBe(n);
    }
  });
});
