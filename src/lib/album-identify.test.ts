import { describe, expect, it } from "vitest";
import { stripTrailingBrackets } from "./album-identify";

describe("stripTrailingBrackets", () => {
  it("strips a trailing parenthesized suffix", () => {
    expect(stripTrailingBrackets("Album (Deluxe Edition)")).toBe("Album");
  });

  it("strips a trailing bracketed suffix", () => {
    expect(stripTrailingBrackets("Album [Remastered]")).toBe("Album");
  });

  it("returns null when there is no trailing bracket group", () => {
    expect(stripTrailingBrackets("Album")).toBeNull();
  });

  it("returns null instead of an empty string when the whole title is the bracket group", () => {
    expect(stripTrailingBrackets("(Live)")).toBeNull();
  });

  it("does not strip a bracket group that isn't at the end of the string", () => {
    expect(stripTrailingBrackets("(Live) Album")).toBeNull();
  });

  it("strips from the first opening bracket through the end on multiple trailing groups", () => {
    // Lazy `.*?` still has to reach end-of-string, so it spans both groups, not just the last.
    expect(stripTrailingBrackets("Album (Live) [Remastered]")).toBe("Album");
  });

  it("strips a nested bracket group anchored at the end", () => {
    expect(stripTrailingBrackets("Album (Deluxe [2020] Edition)")).toBe("Album");
  });

  it("allows mismatched bracket/paren delimiters to still close the group", () => {
    expect(stripTrailingBrackets("Album (Live]")).toBe("Album");
  });

  it("returns null when brackets are mismatched but not at the true end", () => {
    expect(stripTrailingBrackets("Album (Live] mismatched")).toBeNull();
  });
});
