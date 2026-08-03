import { describe, expect, it } from "vitest";
import { parseLrc } from "./lrclib";

describe("parseLrc", () => {
  it("parses a two-digit centisecond timestamp", () => {
    expect(parseLrc("[00:12.34]hello")).toEqual([{ timeSec: 12.34, text: "hello" }]);
  });

  it("parses a three-digit millisecond timestamp", () => {
    expect(parseLrc("[01:02.345]hi")).toEqual([{ timeSec: 62.345, text: "hi" }]);
  });

  it("reads two-digit fractions as centiseconds, not milliseconds", () => {
    // "[00:00.05]" is 50ms, not 5ms. The parser pads right, so a regression to
    // parseInt-as-milliseconds shows up here as 0.005.
    expect(parseLrc("[00:00.05]x")[0]!.timeSec).toBeCloseTo(0.05, 5);
  });

  it("carries minutes past 60 seconds", () => {
    expect(parseLrc("[03:07.00]late")[0]!.timeSec).toBe(187);
  });

  it("trims the line text", () => {
    expect(parseLrc("[00:01.00]   spaced   ")[0]!.text).toBe("spaced");
  });

  it("keeps an empty line as an empty-text entry", () => {
    // Instrumental gaps are timed lines with no words; dropping them would break the
    // synced-scroll highlight at every gap.
    expect(parseLrc("[00:05.00]")).toEqual([{ timeSec: 5, text: "" }]);
  });

  it("sorts output ascending regardless of file order", () => {
    const out = parseLrc("[00:30.00]third\n[00:10.00]first\n[00:20.00]second");
    expect(out.map((l) => l.text)).toEqual(["first", "second", "third"]);
  });

  it("skips metadata tags, blank lines and malformed lines instead of throwing", () => {
    const lrc = [
      "[ar:Some Artist]",
      "[length: 3:21]",
      "",
      "no timestamp at all",
      "[0:5.00]bad digits",
      "[00:11.00]good",
    ].join("\n");
    expect(parseLrc(lrc)).toEqual([{ timeSec: 11, text: "good" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseLrc("")).toEqual([]);
  });

  it("tolerates CRLF line endings", () => {
    expect(parseLrc("[00:01.00]a\r\n[00:02.00]b").map((l) => l.text)).toEqual(["a", "b"]);
  });
});
