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

  it("evicts nothing when re-writing a key it already holds at the cap", () => {
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 2);
    cappedSet(cache, "b", 2, 2);
    cappedSet(cache, "b", 9, 2);
    expect([...cache.entries()]).toEqual([
      ["a", 1],
      ["b", 9],
    ]);
  });

  it("stays at the cap under a workload that only re-writes its own keys", () => {
    // The cover and artist caches do exactly this: same ids, new values. Before the
    // has() check they ran permanently at one entry, evicting a live one per write.
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 0, 2);
    cappedSet(cache, "b", 0, 2);
    for (let i = 1; i <= 50; i++) {
      cappedSet(cache, "a", i, 2);
      cappedSet(cache, "b", i, 2);
    }
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(50);
    expect(cache.get("b")).toBe(50);
  });

  it("keeps insertion order on overwrite, so the oldest key stays the eviction target", () => {
    // Insertion order, not LRU: re-writing a key does not make it younger, because
    // Map.set on an existing key leaves its position alone.
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 2);
    cappedSet(cache, "b", 2, 2);
    cappedSet(cache, "a", 9, 2);
    cappedSet(cache, "c", 3, 2);
    expect([...cache.keys()]).toEqual(["b", "c"]);
  });

  it("stores nothing durably when the cap is zero", () => {
    const cache = new Map<string, number>();
    cappedSet(cache, "a", 1, 0);
    cappedSet(cache, "b", 2, 0);
    expect(cache.size).toBe(1);
    expect(cache.has("b")).toBe(true);
  });
});
