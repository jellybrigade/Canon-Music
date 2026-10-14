// Repo-wide guard for known-issues: "`Number(x) || fallback` deletes a legal zero." A typed or
// chosen 0 (Raw cast quality, staleness, a zero threshold) reads as falsy and snaps to the
// default. Every parse with a fallback goes through `parseNumberOr` instead.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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

const PARSE_THEN_OR = /\b(?:Number|parseInt|parseFloat)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*\|\|/;

export function defaultsWithOr(line: string): boolean {
  if (/^\s*(\/\/|\/?\*)/.test(line)) return false;
  return PARSE_THEN_OR.test(line);
}

describe("numeric parse fallbacks", () => {
  it("never default a parsed number with ||", () => {
    const hits = sourceFiles(SRC_DIR).flatMap((path) =>
      readFileSync(path, "utf-8")
        .split("\n")
        .flatMap((line, index) =>
          defaultsWithOr(line) ? [`${path.slice(SRC_DIR.length)}:${index + 1} ${line.trim()}`] : []
        )
    );
    expect(hits).toEqual([]);
  });
});

describe("the sweep's own reach", () => {
  it("sees the shape through nested calls and every parser", () => {
    expect(defaultsWithOr("const n = Number(x) || 30;")).toBe(true);
    expect(defaultsWithOr("Math.max(0, parseInt(raw, 10) || 50)")).toBe(true);
    expect(defaultsWithOr('parseInt(getComputedStyle(el).getPropertyValue("--h")) || 92')).toBe(true);
    expect(defaultsWithOr("parseFloat(a.match) || 0")).toBe(true);
  });

  it("ignores comments, a bare parse and a ?? fallback", () => {
    expect(defaultsWithOr("  // `Number(raw) || 50` sent zero down the falsy branch")).toBe(false);
    expect(defaultsWithOr("/** a `0` that `Number(x) || fallback` loses. */")).toBe(false);
    expect(defaultsWithOr("const n = Number(x);")).toBe(false);
    expect(defaultsWithOr("const n = parseNumberOr(x, 30) ?? y || z;")).toBe(false);
  });
});
