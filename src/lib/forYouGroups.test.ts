import { describe, expect, it } from "vitest";
import {
  FOR_YOU_PER_TAB_DEFAULT,
  FOR_YOU_PER_TAB_MAX,
  FOR_YOU_PER_TAB_MIN,
  buildForYouGroups,
  parseForYouPerTab,
  type ForYouCategoryConfig,
} from "./forYouGroups";
import type { AlbumRow } from "../types/library";

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

describe("buildForYouGroups", () => {
  it("fills each tab up to the per-tab count", () => {
    const groups = buildForYouGroups([], { a: albums("a", 30), b: albums("b", 30) }, config, 1, 12);
    expect(groups.map((g) => g.albums.length)).toEqual([12, 12]);
  });

  it("shows fewer than the count when the source runs out", () => {
    const groups = buildForYouGroups([], { a: albums("a", 3), b: albums("b", 30) }, config, 1, 12);
    expect(groups.map((g) => g.albums.length)).toEqual([3, 12]);
  });

  it("lets earlier tabs claim shared albums first, so a large count starves later tabs", () => {
    const shared = albums("x", 10);
    const groups = buildForYouGroups([], { a: shared, b: shared }, config, 1, 8);
    expect(groups.map((g) => g.albums.length)).toEqual([8, 2]);
  });

  it("never repeats a spotlight album", () => {
    const source = albums("a", 5);
    const groups = buildForYouGroups(["a0", "a1"], { a: source }, [config[0]!], 1, 10);
    expect(groups[0]!.albums.map((a) => a.id).sort()).toEqual(["a2", "a3", "a4"]);
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
