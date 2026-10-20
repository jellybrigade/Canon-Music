import { describe, expect, it } from "vitest";
import { matchRanges } from "./matchRanges";

describe("matchRanges", () => {
  it("finds every token, ignoring case", () => {
    expect(matchRanges("Dark Side of the Moon", ["dark", "MOON"])).toEqual([
      { start: 0, end: 4 },
      { start: 17, end: 21 },
    ]);
  });

  it("merges overlapping and touching hits into one range", () => {
    expect(matchRanges("abcdef", ["abc", "bcd", "ef"])).toEqual([{ start: 0, end: 6 }]);
  });

  it("marks every occurrence of a token", () => {
    expect(matchRanges("la la land", ["la"])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it("ignores empty tokens and text that holds none of them", () => {
    expect(matchRanges("Abba", ["", "zz"])).toEqual([]);
  });
});
