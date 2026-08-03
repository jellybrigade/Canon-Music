import { describe, expect, it } from "vitest";
import { cappedSet } from "./boundedCache";

describe("cappedSet", () => {
  it("stores below the cap without evicting", () => {
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 3);
    cappedSet(cache, "b", 2, 3);
    expect([...cache.keys()]).toEqual(["a", "b"]);
  });

  it("evicts the oldest key once the cap is reached", () => {
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 2);
    cappedSet(cache, "b", 2, 2);
    cappedSet(cache, "c", 3, 2);
    expect([...cache.keys()]).toEqual(["b", "c"]);
    expect(cache.size).toBe(2);
  });

  it("keeps the cache at the cap over many inserts", () => {
    const cache = new Map<number, number>();
    for (let i = 0; i < 100; i++) cappedSet(cache, i, i, 8);
    expect(cache.size).toBe(8);
    expect([...cache.keys()]).toEqual([92, 93, 94, 95, 96, 97, 98, 99]);
  });

  it("updates the value when re-writing a key already in the cache", () => {
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 3);
    cappedSet(cache, "a", 9, 3);
    expect(cache.get("a")).toBe(9);
    expect(cache.size).toBe(1);
  });

  it("evicts the oldest entry even when re-writing a key it already holds", () => {
    // The size check runs before the set, so at the cap a plain overwrite still costs one
    // eviction. Callers that re-write hot keys therefore hold fewer than `maxEntries` live
    // entries; documented here rather than discovered as a mystery cache miss.
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 2);
    cappedSet(cache, "b", 2, 2);
    cappedSet(cache, "b", 9, 2);
    expect([...cache.entries()]).toEqual([["b", 9]]);
  });

  it("stores nothing durably when the cap is zero", () => {
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 0);
    cappedSet(cache, "b", 2, 0);
    expect(cache.size).toBe(1);
    expect(cache.has("b")).toBe(true);
  });
});
