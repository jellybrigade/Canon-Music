import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStale, isYearLikeGenre, type NormalizedTags } from "./tag-normalize";

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
