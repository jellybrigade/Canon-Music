import { describe, expect, it } from "vitest";
import { combineGenres } from "./musicbrainz";

describe("combineGenres", () => {
  it("returns an empty array when both inputs are empty", () => {
    expect(combineGenres([], [])).toEqual([]);
  });

  it("passes through one side unchanged (still sorted) when the other is empty", () => {
    const rg = [{ name: "Rock", count: 3 }, { name: "Jazz", count: 5 }];
    expect(combineGenres(rg, [])).toEqual([
      { name: "Jazz", count: 5 },
      { name: "Rock", count: 3 },
    ]);
    expect(combineGenres([], rg)).toEqual([
      { name: "Jazz", count: 5 },
      { name: "Rock", count: 3 },
    ]);
  });

  it("dedupes case-insensitively across release-group and release, summing counts", () => {
    const result = combineGenres([{ name: "Rock", count: 3 }], [{ name: "rock", count: 2 }]);
    expect(result).toEqual([{ name: "Rock", count: 5 }]);
  });

  it("keeps the release-group's casing when it wins the dedupe", () => {
    // Release-group entries are spread first, so its casing is `existing` on the second hit.
    const result = combineGenres([{ name: "ROCK", count: 1 }], [{ name: "rock", count: 1 }]);
    expect(result).toEqual([{ name: "ROCK", count: 2 }]);
  });

  it("merges duplicate names within a single side, not only across sides", () => {
    const result = combineGenres(
      [{ name: "Rock", count: 1 }, { name: "rock", count: 4 }],
      []
    );
    expect(result).toEqual([{ name: "Rock", count: 5 }]);
  });

  it("does not trim or normalize whitespace, so a trailing-space variant is a distinct entry", () => {
    const result = combineGenres([{ name: "Rock", count: 1 }], [{ name: "Rock ", count: 1 }]);
    expect(result).toHaveLength(2);
  });

  it("sorts strictly descending by count, including zero and negative counts", () => {
    const result = combineGenres(
      [{ name: "A", count: -1 }, { name: "B", count: 0 }, { name: "C", count: 5 }],
      []
    );
    expect(result.map((g) => g.name)).toEqual(["C", "B", "A"]);
  });
});
