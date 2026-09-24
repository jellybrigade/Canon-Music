import { describe, expect, it } from "vitest";
import { isOwnedByServer, stripServerPrefix } from "./ids";

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

describe("isOwnedByServer", () => {
  it("accepts an id prefixed by one of the known servers", () => {
    expect(isOwnedByServer("srv-2:track-9", ["srv-1", "srv-2"])).toBe(true);
  });

  it("rejects an id whose server is gone", () => {
    expect(isOwnedByServer("srv-3:track-9", ["srv-1", "srv-2"])).toBe(false);
  });

  it("rejects everything when no server is left", () => {
    expect(isOwnedByServer("srv-1:track-9", [])).toBe(false);
  });

  it("rejects an unprefixed id", () => {
    expect(isOwnedByServer("track-9", ["srv-1"])).toBe(false);
  });

  it("rejects a server id that only appears mid-string", () => {
    expect(isOwnedByServer("other:srv-1:track-9", ["srv-1"])).toBe(false);
  });

  it("rejects an id that merely starts with the server id without the separator", () => {
    // A UUID is not a prefix of another UUID, but the check must not depend on that.
    expect(isOwnedByServer("srv-10:track-9", ["srv-1"])).toBe(false);
  });
});
