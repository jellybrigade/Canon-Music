import { describe, expect, it } from "vitest";
import { stripServerPrefix } from "./ids";

describe("stripServerPrefix", () => {
  it("strips the server prefix", () => {
    expect(stripServerPrefix("srv-1:track-9", "srv-1")).toBe("track-9");
  });

  it("keeps colons that belong to the native id", () => {
    expect(stripServerPrefix("srv-1:a:b:c", "srv-1")).toBe("a:b:c");
  });

  it("throws when the prefix is absent rather than returning the id unchanged", () => {
    // Returning the raw id would build a stream URL against the wrong server's track id,
    // which fails as a 404 far away from the cause.
    expect(() => stripServerPrefix("track-9", "srv-1")).toThrow(/missing expected server prefix/);
  });

  it("throws when the prefix only appears mid-string", () => {
    expect(() => stripServerPrefix("other:srv-1:track-9", "srv-1")).toThrow();
  });

  it("throws when the prefix matches another server", () => {
    expect(() => stripServerPrefix("srv-2:track-9", "srv-1")).toThrow();
  });

  it("returns an empty native id for a bare prefix", () => {
    expect(stripServerPrefix("srv-1:", "srv-1")).toBe("");
  });
});
