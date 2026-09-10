// Repo-wide guard for known-issues: a cover art id asserted non-null with `!` instead of
// branched on. `encodeURIComponent(undefined)` is the string "undefined", so the app asks the
// server for a cover named "undefined" and Rust caches that 404 forever under "undefined:300",
// once per album with no artwork. 30 call sites branch correctly; a per-call-site test cannot
// see the 31st, so this sweeps every `getCoverArtUrl` call in `src/`.
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

/** Argument list of every `getCoverArtUrl(...)` call, split on top-level commas. */
function callSites(text: string): { line: number; args: string[] }[] {
  const sites: { line: number; args: string[] }[] = [];
  const CALL = /\bgetCoverArtUrl\s*\(/g;
  for (const match of text.matchAll(CALL)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    const inner = text.slice(start, i - 1);
    const args: string[] = [];
    let current = "";
    let nested = 0;
    for (const ch of inner) {
      if (ch === "(" || ch === "[" || ch === "{") nested++;
      if (ch === ")" || ch === "]" || ch === "}") nested--;
      if (ch === "," && nested === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim()) args.push(current.trim());
    sites.push({ line: text.slice(0, match.index).split("\n").length, args });
  }
  return sites;
}

const FILES = sourceFiles(SRC_DIR)
  .map((path) => ({ path: path.slice(SRC_DIR.length), text: readFileSync(path, "utf-8") }))
  .filter(({ path }) => !path.endsWith("lib/navidrome.ts"));

describe("getCoverArtUrl call sites", () => {
  it("finds the call sites at all, so a rename cannot silently empty this sweep", () => {
    const total = FILES.reduce((n, f) => n + callSites(f.text).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it("never asserts the cover art id non-null instead of branching on it", () => {
    const asserted = FILES.flatMap(({ path, text }) =>
      callSites(text)
        .filter((site) => /!$/.test(site.args[3] ?? ""))
        .map((site) => `${path}:${site.line} ${site.args[3]}`)
    );
    expect(asserted).toEqual([]);
  });
});
