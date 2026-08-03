import { describe, expect, it } from "vitest";
import { bucketize } from "./tag-buckets";
import type { CanonTree, NodeSection, TreeNode } from "./canonicalize";

function node(id: string, section?: NodeSection): TreeNode {
  return { id, name: id, type: "genre", canonical_key: id, parents: [], section };
}

/** Only `byId` is read by bucketize, so the rest of the tree is left empty on purpose. */
function tree(nodes: TreeNode[]): CanonTree {
  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    byKey: new Map(),
    nodesByKind: new Map(),
    byKindAndKey: new Map(),
  };
}

describe("bucketize", () => {
  const t = tree([
    node("art-rock", "genres"),
    node("melancholic", "descriptors"),
    node("shoegaze-revival", "scenes-and-movements"),
    node("no-section-node"),
  ]);

  it("sorts each id into the bucket named by its section", () => {
    expect(bucketize(["art-rock", "melancholic", "shoegaze-revival"], t)).toEqual({
      genres: ["art-rock"],
      descriptors: ["melancholic"],
      scenes: ["shoegaze-revival"],
    });
  });

  it("drops ids the tree does not know", () => {
    expect(bucketize(["art-rock", "raw:not-in-tree"], t).genres).toEqual(["art-rock"]);
  });

  it("drops a node carrying no section rather than guessing one", () => {
    const out = bucketize(["no-section-node"], t);
    expect(out).toEqual({ genres: [], descriptors: [], scenes: [] });
  });

  it("preserves input order within a bucket", () => {
    const ordered = tree([node("b", "genres"), node("a", "genres"), node("c", "genres")]);
    expect(bucketize(["b", "a", "c"], ordered).genres).toEqual(["b", "a", "c"]);
  });

  it("keeps a repeated id in both slots rather than deduping", () => {
    expect(bucketize(["art-rock", "art-rock"], t).genres).toEqual(["art-rock", "art-rock"]);
  });

  it("returns three empty buckets for no ids", () => {
    expect(bucketize([], t)).toEqual({ genres: [], descriptors: [], scenes: [] });
  });
});
