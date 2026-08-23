import { describe, expect, it } from "vitest";
import { shuffleArray } from "./shuffle";

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
