import { describe, expect, it } from "vitest";
import { releaseDateText } from "./releaseDate";

describe("releaseDateText", () => {
  it("writes as much of the date as the tags name, zero-padded so text order is date order", () => {
    expect(releaseDateText({ year: 2026, month: 10, day: 30 })).toBe("2026-10-30");
    expect(releaseDateText({ year: 2026, month: 3, day: 7 })).toBe("2026-03-07");
    expect(releaseDateText({ year: 2026, month: 3 })).toBe("2026-03");
    expect(releaseDateText({ year: 2026 })).toBe("2026");
  });

  it("drops a day without a month", () => {
    expect(releaseDateText({ year: 2026, day: 4 })).toBe("2026");
  });

  it("has no date without a usable year", () => {
    expect(releaseDateText(undefined)).toBeNull();
    expect(releaseDateText({})).toBeNull();
    expect(releaseDateText({ year: 0, month: 1, day: 1 })).toBeNull();
    expect(releaseDateText({ year: 12345 })).toBeNull();
  });

  it("stops at the first part a server sent out of range", () => {
    expect(releaseDateText({ year: 2026, month: 0, day: 5 })).toBe("2026");
    expect(releaseDateText({ year: 2026, month: 13 })).toBe("2026");
    expect(releaseDateText({ year: 2026, month: 2, day: 32 })).toBe("2026-02");
    expect(releaseDateText({ year: 2026.5 })).toBeNull();
  });
});
