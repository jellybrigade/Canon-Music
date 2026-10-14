import { describe, expect, it } from "vitest";
import { parseIntegerOr, parseNumberOr, parseStalenessDays } from "./numberSetting";

describe("parseNumberOr", () => {
  it("keeps a legal zero", () => {
    expect(parseNumberOr("0", 320)).toBe(0);
    expect(parseNumberOr("0", null)).toBe(0);
  });

  it("falls back on a blank, missing or unreadable value", () => {
    expect(parseNumberOr("", 30)).toBe(30);
    expect(parseNumberOr("   ", 30)).toBe(30);
    expect(parseNumberOr(null, 30)).toBe(30);
    expect(parseNumberOr(undefined, 30)).toBe(30);
    expect(parseNumberOr("abc", 30)).toBe(30);
    expect(parseNumberOr("Infinity", 30)).toBe(30);
  });

  it("reads the whole string, not a leading number", () => {
    expect(parseNumberOr(" 2.5 ", 0)).toBe(2.5);
    expect(parseNumberOr("320kbps", 0)).toBe(0);
  });

  it("reads plain decimals only, not hex, binary or exponent forms", () => {
    expect(parseNumberOr("-1.5", 0)).toBe(-1.5);
    expect(parseNumberOr(".5", 0)).toBe(0.5);
    expect(parseNumberOr("0x10", 7)).toBe(7);
    expect(parseNumberOr("0b11", 7)).toBe(7);
    expect(parseNumberOr("1e3", 7)).toBe(7);
  });
});

describe("parseIntegerOr", () => {
  it("truncates a fraction and keeps a legal zero", () => {
    expect(parseIntegerOr("192.5", 320)).toBe(192);
    expect(parseIntegerOr("0", 320)).toBe(0);
    expect(parseIntegerOr("", 320)).toBe(320);
    expect(parseIntegerOr("abc", 320)).toBe(320);
  });
});

describe("parseStalenessDays", () => {
  it("floors a zero window at one day and falls back on a negative or unreadable value", () => {
    expect(parseStalenessDays("0")).toBe(1);
    expect(parseStalenessDays("0.5")).toBe(1);
    expect(parseStalenessDays("7")).toBe(7);
    expect(parseStalenessDays("-1")).toBe(30);
    expect(parseStalenessDays("")).toBe(30);
    expect(parseStalenessDays(undefined)).toBe(30);
  });
});
