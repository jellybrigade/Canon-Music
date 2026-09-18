import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStale, isYearLikeGenre, resolveGenreTags, type NormalizedTags } from "./tag-normalize";
import { canonicalKey, type CanonTree, type TreeNode } from "./canonicalize";

describe("isYearLikeGenre", () => {
  it("matches a four-digit decade with trailing s", () => {
    expect(isYearLikeGenre("1990s")).toBe(true);
  });

  it("matches a two-digit decade with trailing s", () => {
    expect(isYearLikeGenre("80s")).toBe(true);
  });

  it("matches a bare four-digit year", () => {
    expect(isYearLikeGenre("2013")).toBe(true);
  });

  it("matches a leading-apostrophe two-digit decade", () => {
    expect(isYearLikeGenre("'90s")).toBe(true);
  });

  it("does not match a trailing-apostrophe decade (apostrophe on the wrong side)", () => {
    expect(isYearLikeGenre("90's")).toBe(false);
  });

  it("does not match a genre name", () => {
    expect(isYearLikeGenre("Nu Metal")).toBe(false);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(isYearLikeGenre("  1990s  ")).toBe(true);
  });
});

describe("isStale", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function tagsAt(computedAt: number): NormalizedTags {
    return { genres: [], descriptors: [], scenes: [], computed_at: computedAt };
  }

  it("is stale when tags are null", () => {
    expect(isStale(null)).toBe(true);
  });

  it("is not stale exactly at the boundary (strictly greater-than only)", () => {
    const staleDays = 30;
    const computedAt = Math.floor(Date.now() / 1000) - staleDays * 24 * 60 * 60;
    expect(isStale(tagsAt(computedAt), staleDays)).toBe(false);
  });

  it("is stale one second past the boundary", () => {
    const staleDays = 30;
    const computedAt = Math.floor(Date.now() / 1000) - staleDays * 24 * 60 * 60 - 1;
    expect(isStale(tagsAt(computedAt), staleDays)).toBe(true);
  });

  it("is not stale for a future computed_at", () => {
    const futureComputedAt = Math.floor(Date.now() / 1000) + 60 * 60;
    expect(isStale(tagsAt(futureComputedAt))).toBe(false);
  });

  it("honors a custom staleDays", () => {
    const computedAt = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
    expect(isStale(tagsAt(computedAt), 1)).toBe(true);
    expect(isStale(tagsAt(computedAt), 3)).toBe(false);
  });
});

describe("resolveGenreTags", () => {
  const rock: TreeNode = { id: "rock", name: "Rock", type: "genre", canonical_key: "rock", parents: [], sections: ["genres"] };
  const jazz: TreeNode = { id: "jazz", name: "Jazz", type: "genre", canonical_key: "jazz", parents: [], sections: ["genres"] };

  function treeOf(nodes: TreeNode[]): CanonTree {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const byKey = new Map(nodes.map((n) => [n.canonical_key, n]));
    return {
      nodes,
      byKey,
      byId,
      nodesByKind: new Map([["genre", nodes]]),
      byKindAndKey: new Map([["genre", byKey]]),
    };
  }

  function resolve(over: Partial<Parameters<typeof resolveGenreTags>[0]>) {
    return resolveGenreTags({
      tree: treeOf([rock, jazz]),
      userGenres: [],
      entries: [],
      manualMap: new Map(),
      excludedIds: new Set(),
      ...over,
    });
  }

  it("maps a user genre whose node exists as a manual tag", () => {
    const { mapped, unmapped } = resolve({ userGenres: [{ canonical_id: "rock", name: "Rock" }] });
    expect(mapped).toEqual([{ id: "rock", name: "Rock", source: "manual", confidence: 1.0 }]);
    expect(unmapped).toEqual([]);
  });

  it("reports a user genre whose node is gone as unmapped instead of dropping it", () => {
    const { mapped, unmapped } = resolve({ userGenres: [{ canonical_id: "user:gone", name: "Doom Jazz" }] });
    expect(mapped).toEqual([]);
    expect(unmapped).toEqual([{ id: null, name: "Doom Jazz", source: "manual", confidence: 1.0 }]);
  });

  it("drops a duplicate user genre silently", () => {
    const { mapped, unmapped } = resolve({
      userGenres: [
        { canonical_id: "rock", name: "Rock" },
        { canonical_id: "rock", name: "Rock" },
      ],
    });
    expect(mapped.length).toBe(1);
    expect(unmapped).toEqual([]);
  });

  it("reports a tag manually mapped to a node that is gone as unmapped", () => {
    const { mapped, unmapped } = resolve({
      entries: [{ name: "Doom-Jazz", source: "file" }],
      manualMap: new Map([[canonicalKey("Doom-Jazz"), "user:gone"]]),
    });
    expect(mapped).toEqual([]);
    expect(unmapped).toEqual([{ id: null, name: "Doom-Jazz", source: "file", confidence: 1.0 }]);
  });

  it("keeps a manual mapping to an excluded or already-seen node silent", () => {
    const { mapped, unmapped } = resolve({
      userGenres: [{ canonical_id: "rock", name: "Rock" }],
      entries: [
        { name: "Rawk", source: "file" },
        { name: "Jazzy", source: "lastfm" },
      ],
      manualMap: new Map([
        [canonicalKey("Rawk"), "rock"],
        [canonicalKey("Jazzy"), "jazz"],
      ]),
      excludedIds: new Set(["jazz"]),
    });
    expect(mapped.map((t) => t.id)).toEqual(["rock"]);
    expect(unmapped).toEqual([]);
  });
});
