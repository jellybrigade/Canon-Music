import { describe, expect, it } from "vitest";
import { bitrateCell, durationCell, formatDuration } from "./trackCells";

describe("track cells", () => {
  it("prints a zero and leaves only a missing value blank", () => {
    expect(durationCell(0)).toBe("0:00");
    expect(durationCell(185)).toBe("3:05");
    expect(durationCell(null)).toBe("");
    expect(durationCell(undefined)).toBe("");
    expect(bitrateCell(0)).toBe("0k");
    expect(bitrateCell(320)).toBe("320k");
    expect(bitrateCell(null)).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats a sub-minute position with a zero-padded seconds field", () => {
    expect(formatDuration(7)).toBe("0:07");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("rolls over to the next minute at exactly 60 seconds", () => {
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(61)).toBe("1:01");
  });

  it("does not pad the minutes field", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("lets minutes run past 59 rather than growing an hours field", () => {
    // The transport row has no hours slot, so a 90-minute track reads as "90:00".
    expect(formatDuration(3600)).toBe("60:00");
    expect(formatDuration(5400)).toBe("90:00");
  });

  it("floors fractional seconds instead of rounding up", () => {
    expect(formatDuration(59.9)).toBe("0:59");
    expect(formatDuration(0.4)).toBe("0:00");
  });

  it("emits a malformed string on a negative position rather than clamping", () => {
    // JS `%` keeps the sign, and padStart is a no-op on the 2-char "-1", so the seconds
    // field comes out negative and unpadded. Pinned as current behavior, not endorsed:
    // callers clamp elapsed to >= 0 before display, which is why this never surfaces.
    expect(formatDuration(-1)).toBe("-1:-1");
    expect(formatDuration(-61)).toBe("-2:-1");
  });

  it("produces NaN fields rather than throwing on a missing duration", () => {
    // duration is optional on a track, so undefined reaches this via arithmetic.
    expect(formatDuration(NaN)).toBe("NaN:NaN");
  });
});
