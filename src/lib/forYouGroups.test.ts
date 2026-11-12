import { describe, expect, it } from "vitest";
import type { AlbumRow } from "../types/library";
import {
  buildForYouGroups,
  FOR_YOU_PER_TAB_DEFAULT,
  FOR_YOU_PER_TAB_MAX,
  FOR_YOU_PER_TAB_MIN,
  type ForYouCategoryConfig,
  parseForYouLocks,
  parseForYouPerTab,
  pickForYouOrders,
} from "./forYouGroups";

function albums(prefix: string, count: number): AlbumRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    server_id: "s",
    name: `${prefix}${i}`,
    artist: null,
    year: null,
    artwork_url: `art-${prefix}${i}`,
  }));
}

const config: ForYouCategoryConfig[] = [
  { key: "a", kicker: "A", enabled: true },
  { key: "b", kicker: "B", enabled: true },
];

function build(sources: Record<string, AlbumRow[]>, perTab: number, excludedIds: string[] = [], cats = config) {
  const orders = pickForYouOrders({}, { sources, config: cats, seed: 1, excludedIds });
  return buildForYouGroups({ orders, sources, config: cats, perTab });
}

describe("buildForYouGroups", () => {
  it("fills each tab up to the per-tab count", () => {
    const groups = build({ a: albums("a", 30), b: albums("b", 30) }, 12);
    expect(groups.map((g) => g.albums.length)).toEqual([12, 12]);
  });

  it("shows fewer than the count when the source runs out", () => {
    const groups = build({ a: albums("a", 3), b: albums("b", 30) }, 12);
    expect(groups.map((g) => g.albums.length)).toEqual([3, 12]);
  });

  it("lets earlier tabs claim shared albums first, so a large count starves later tabs", () => {
    const shared = albums("x", 10);
    const groups = build({ a: shared, b: shared }, 8);
    expect(groups.map((g) => g.albums.length)).toEqual([8, 2]);
  });

  it("never repeats an album excluded when picking", () => {
    const groups = build({ a: albums("a", 5) }, 10, ["a0", "a1"], [config[0]!]);
    expect(groups[0]!.albums.map((a) => a.id).sort()).toEqual(["a2", "a3", "a4"]);
  });
});

describe("pickForYouOrders", () => {
  const ids = (groups: { albums: AlbumRow[] }[]) => groups.map((g) => g.albums.map((a) => a.id));

  it("keeps the picks when a source gains, loses or reorders albums", () => {
    const sources = { a: albums("a", 30), b: albums("b", 30) };
    const orders = pickForYouOrders({}, { sources, config, seed: 7, excludedIds: [] });
    const before = ids(buildForYouGroups({ orders, sources, config, perTab: 6 }));

    const changed = { a: [...albums("a", 30).slice(5).reverse(), ...albums("n", 10)], b: albums("b", 2) };
    const next = pickForYouOrders(orders, { sources: changed, config, seed: 7, excludedIds: ["a3"] });
    expect(next).toBe(orders);
    expect(ids(buildForYouGroups({ orders: next, sources: changed, config, perTab: 6 }))).toEqual(before);
  });

  it("shows the latest copy of a picked album", () => {
    const sources = { a: albums("a", 3) };
    const orders = pickForYouOrders({}, { sources, config: [config[0]!], seed: 1, excludedIds: [] });
    const updated = { a: albums("a", 3).map((a) => ({ ...a, artwork_url: `new-${a.id}` })) };
    const shown = buildForYouGroups({ orders, sources: updated, config: [config[0]!], perTab: 6 })[0]!.albums;
    expect(shown.map((a) => a.artwork_url).sort()).toEqual(["new-a0", "new-a1", "new-a2"]);
  });

  it("picks a tab once its albums arrive and leaves earlier picks alone", () => {
    const first = pickForYouOrders({}, { sources: { a: albums("a", 10), b: [] }, config, seed: 1, excludedIds: [] });
    expect(first.b).toBeUndefined();
    const second = pickForYouOrders(first, {
      sources: { a: albums("a", 10), b: albums("b", 10) },
      config,
      seed: 1,
      excludedIds: [],
    });
    expect(second.a).toBe(first.a);
    expect(second.b).toHaveLength(10);
  });

  it("orders differently for a different seed", () => {
    const sources = { a: albums("a", 30) };
    const one = pickForYouOrders({}, { sources, config: [config[0]!], seed: 1, excludedIds: [] });
    const two = pickForYouOrders({}, { sources, config: [config[0]!], seed: 2, excludedIds: [] });
    expect(one.a!.map((a) => a.id)).not.toEqual(two.a!.map((a) => a.id));
  });
});

describe("locked tabs", () => {
  const sources = { a: albums("a", 30), b: albums("b", 30) };
  const shown = (groups: { key: string; albums: AlbumRow[] }[], key: string) =>
    groups.find((g) => g.key === key)?.albums.map((a) => a.id);

  it("shows exactly the locked albums, in lock order, whatever the pick", () => {
    const locks = { b: ["b9", "b2", "b5"] };
    for (const seed of [1, 2, 3]) {
      const orders = pickForYouOrders({}, { sources, config, seed, excludedIds: [] });
      const groups = buildForYouGroups({ orders, sources, config, perTab: 6, locks });
      expect(shown(groups, "b")).toEqual(["b9", "b2", "b5"]);
      expect(groups.find((g) => g.key === "b")?.isLocked).toBe(true);
      expect(groups.find((g) => g.key === "a")?.isLocked).toBe(false);
    }
  });

  it("caps a locked tab at the per-tab count", () => {
    const orders = pickForYouOrders({}, { sources, config, seed: 1, excludedIds: [] });
    const groups = buildForYouGroups({ orders, sources, config, perTab: 2, locks: { a: ["a1", "a2", "a3"] } });
    expect(shown(groups, "a")).toEqual(["a1", "a2"]);
  });

  it("keeps a locked album out of every other tab, earlier ones included", () => {
    const shared = albums("x", 6);
    const both = { a: shared, b: shared };
    const orders = pickForYouOrders({}, { sources: both, config, seed: 1, excludedIds: [] });
    const groups = buildForYouGroups({ orders, sources: both, config, perTab: 6, locks: { b: ["x0", "x1"] } });
    expect(shown(groups, "a")).not.toContain("x0");
    expect(shown(groups, "a")).not.toContain("x1");
    expect(shown(groups, "b")).toEqual(["x0", "x1"]);
  });

  it("finds a locked album in the library after it leaves its source, and drops one gone from the library", () => {
    const library = [...albums("a", 30), ...albums("b", 2)];
    const orders = pickForYouOrders({}, { sources, config, seed: 1, excludedIds: [] });
    const groups = buildForYouGroups({
      orders,
      sources: { a: albums("a", 30), b: [] },
      library,
      config,
      perTab: 6,
      locks: { b: ["b1", "gone"] },
    });
    expect(shown(groups, "b")).toEqual(["b1"]);
  });
});

describe("albums shown elsewhere or gone", () => {
  const sources = { a: albums("a", 8), b: albums("b", 8) };
  const shown = (groups: { key: string; albums: AlbumRow[] }[]) => groups.flatMap((g) => g.albums.map((a) => a.id));

  it("keeps a spotlight that changed after the pick out of every tab, locked ones included", () => {
    const orders = pickForYouOrders({}, { sources, config, seed: 1, excludedIds: [] });
    const groups = buildForYouGroups({
      orders,
      sources,
      config,
      perTab: 8,
      locks: { b: ["b1", "b2"] },
      excludedIds: ["a3", "b1"],
    });
    expect(shown(groups)).not.toContain("a3");
    expect(shown(groups)).not.toContain("b1");
    expect(groups.find((g) => g.key === "b")?.albums.map((a) => a.id)).toEqual(["b2"]);
  });

  it("drops a pick gone from the library or left without artwork", () => {
    const orders = pickForYouOrders({}, { sources, config: [config[0]!], seed: 1, excludedIds: [] });
    const library = albums("a", 8)
      .filter((a) => a.id !== "a2")
      .map((a) => (a.id === "a5" ? { ...a, artwork_url: null } : a));
    const groups = buildForYouGroups({ orders, sources: { a: [] }, library, config: [config[0]!], perTab: 8 });
    expect(shown(groups).sort()).toEqual(["a0", "a1", "a3", "a4", "a6", "a7"]);
  });
});

describe("parseForYouLocks", () => {
  it("reads stored locks and ignores anything malformed", () => {
    expect(parseForYouLocks('{"a":["x","y"]}')).toEqual({ a: ["x", "y"] });
    expect(parseForYouLocks('{"a":["x",3],"b":"y","c":["z"]}')).toEqual({ c: ["z"] });
    expect(parseForYouLocks("not json")).toEqual({});
    expect(parseForYouLocks("[1]")).toEqual({});
  });
});

describe("parseForYouPerTab", () => {
  it("reads a stored count", () => {
    expect(parseForYouPerTab("12")).toBe(12);
  });

  it("falls back to the default for empty or garbage input", () => {
    expect(parseForYouPerTab("")).toBe(FOR_YOU_PER_TAB_DEFAULT);
    expect(parseForYouPerTab("abc")).toBe(FOR_YOU_PER_TAB_DEFAULT);
  });

  it("clamps zero and negatives to the minimum rather than the default", () => {
    expect(parseForYouPerTab("0")).toBe(FOR_YOU_PER_TAB_MIN);
    expect(parseForYouPerTab("-4")).toBe(FOR_YOU_PER_TAB_MIN);
  });

  it("clamps above the maximum and rounds fractions", () => {
    expect(parseForYouPerTab("500")).toBe(FOR_YOU_PER_TAB_MAX);
    expect(parseForYouPerTab("7.6")).toBe(8);
  });
});
