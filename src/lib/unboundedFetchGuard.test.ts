// Repo-wide guard for known-issues: "A request with no deadline can hang its spinner forever."
// LRCLIB and lyrics.ovh used bare `fetch`, so a stalled server left lyrics loading for minutes.
// Every request goes through `boundedFetch`, which bounds headers and body alike.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = new Set(["clients/boundedFetch.ts"]);

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

// A call to the global, not a method (`.fetch(`) or a longer name (`refetch(`, `tauriFetch(`).
const BARE_FETCH = /(?<![\w.$])fetch\(/;

/** 1-based lines calling the global `fetch`; comment lines are skipped. */
export function bareFetchLines(source: string): number[] {
  return source
    .split("\n")
    .flatMap((line, index) => (!/^\s*(\/\/|\/?\*)/.test(line) && BARE_FETCH.test(line) ? [index + 1] : []));
}

describe("network requests", () => {
  it("never call fetch without a deadline", () => {
    const hits = sourceFiles(SRC_DIR).flatMap((path) => {
      const relative = path.slice(SRC_DIR.length);
      if (ALLOWED.has(relative)) return [];
      const lines = readFileSync(path, "utf-8").split("\n");
      return bareFetchLines(lines.join("\n")).map((line) => `${relative}:${line} ${lines[line - 1]?.trim()}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("the sweep's own reach", () => {
  it("sees a bare fetch and ignores lookalikes and comments", () => {
    expect(bareFetchLines("const r = await fetch(url);")).toEqual([1]);
    expect(bareFetchLines("res = fetch(url, { method: \"POST\" })")).toEqual([1]);
    expect(bareFetchLines("void query.refetch();\nawait tauriFetch(u);\nwindow.fetch2(x);\nobj.fetch(x);")).toEqual([]);
    expect(bareFetchLines("// Native fetch() is blocked by CORS")).toEqual([]);
  });
});
