// Repo-wide guard for known-issues: "`Number(x) || fallback` deletes a legal zero." A typed or
// chosen 0 (Raw cast quality, staleness, a zero threshold) reads as falsy and snaps to the
// default, and a truthy check before the parse lets NaN through. Every parse with a fallback goes
// through `parseNumberOr` instead.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

const PARSE_CALL = String.raw`\b(?:Number|parseInt|parseFloat)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
// `parse(x) || n` eats a zero; `x ? parse(x) : n` passes NaN through for unreadable text.
// `\s` spans newlines, so a fallback wrapped onto the next line is still seen.
const FALLBACK_SHAPES = [new RegExp(`${PARSE_CALL}\\s*\\|\\|`, "g"), new RegExp(`\\?\\s*${PARSE_CALL}\\s*:`, "g")];

/** 1-based lines where a parsed number gets an unsafe fallback; comment lines are blanked first. */
function fallbackLines(source: string): number[] {
  const code = source
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/?\*)/.test(line) ? "" : line))
    .join("\n");
  const lines = new Set<number>();
  for (const shape of FALLBACK_SHAPES) {
    for (const match of code.matchAll(shape)) {
      lines.add(code.slice(0, match.index).split("\n").length);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

describe("numeric parse fallbacks", () => {
  it("never default a parsed number with || or a truthy ternary", () => {
    const hits = sourceFiles(SRC_DIR).flatMap((path) => {
      const source = readFileSync(path, "utf-8");
      const lines = source.split("\n");
      return fallbackLines(source).map((line) => `${path.slice(SRC_DIR.length)}:${line} ${lines[line - 1]?.trim()}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("the sweep's own reach", () => {
  it("sees the shape through nested calls and every parser", () => {
    expect(fallbackLines("const n = Number(x) || 30;")).toEqual([1]);
    expect(fallbackLines("Math.max(0, parseInt(raw, 10) || 50)")).toEqual([1]);
    expect(fallbackLines('parseInt(getComputedStyle(el).getPropertyValue("--h")) || 92')).toEqual([1]);
    expect(fallbackLines("parseFloat(a.match) || 0")).toEqual([1]);
  });

  it("sees a truthy ternary and a fallback wrapped onto the next line", () => {
    expect(fallbackLines("return v ? parseInt(v, 10) : 50;")).toEqual([1]);
    expect(fallbackLines("const a = 1;\nconst n = Number(x)\n  || 30;")).toEqual([2]);
  });

  it("ignores comments, a bare parse and a ?? fallback", () => {
    expect(fallbackLines("  // `Number(raw) || 50` sent zero down the falsy branch")).toEqual([]);
    expect(fallbackLines("/** a `0` that `Number(x) || fallback` loses. */")).toEqual([]);
    expect(fallbackLines("const n = Number(x);")).toEqual([]);
    expect(fallbackLines("const n = parseNumberOr(x, 30) ?? y || z;")).toEqual([]);
  });
});
