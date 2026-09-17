import { describe, expect, it } from "vitest";
import { sampleFromHead, seededShuffle, shuffleArray } from "./shuffle";

describe("shuffleArray", () => {
  it("returns the same multiset of items", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffleArray(input);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b", "c", "d", "e"];
    const copy = [...input];
    shuffleArray(input);
    expect(input).toEqual(copy);
  });

  it("returns a fresh array, never the argument", () => {
    const input = [1, 2, 3];
    expect(shuffleArray(input)).not.toBe(input);
  });

  it("handles empty and single-element input", () => {
    expect(shuffleArray([])).toEqual([]);
    expect(shuffleArray([42])).toEqual([42]);
  });

  it("does not pin any element to its original position", () => {
    // Statistical, not exact: a Fisher-Yates that skips index 0 (a classic off-by-one)
    // leaves element 0 in place every single time.
    const input = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const firstSeen = new Set<number>();
    for (let run = 0; run < 500; run++) firstSeen.add(shuffleArray(input)[0]!);
    expect(firstSeen.size).toBeGreaterThan(5);
  });
});

describe("seededShuffle", () => {
  it("gives the same order for the same seed and a different one for another", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(input, 7)).toEqual(seededShuffle(input, 7));
    expect(seededShuffle(input, 7)).not.toEqual(seededShuffle(input, 8));
  });

  it("keeps every item and leaves its input alone", () => {
    const input = [5, 4, 3, 2, 1];
    const out = seededShuffle(input, 3);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("sampleFromHead", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it("returns the leading items in order for seed 0", () => {
    expect(sampleFromHead(items, 0, 5, 40)).toEqual([0, 1, 2, 3, 4]);
  });

  it("draws a different set from the head pool for a non-zero seed", () => {
    const out = sampleFromHead(items, 1, 5, 40);
    expect(out).toHaveLength(5);
    expect(out.every(n => n < 40)).toBe(true);
    expect(out).not.toEqual([0, 1, 2, 3, 4]);
  });

  it("is stable for a given seed", () => {
    expect(sampleFromHead(items, 4, 5, 40)).toEqual(sampleFromHead(items, 4, 5, 40));
  });

  it("returns everything available when the list is shorter than the count", () => {
    expect([...sampleFromHead([3, 1, 2], 2, 5, 40)].sort()).toEqual([1, 2, 3]);
    expect(sampleFromHead([], 2, 5, 40)).toEqual([]);
  });
});
