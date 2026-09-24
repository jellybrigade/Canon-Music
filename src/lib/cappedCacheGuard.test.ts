// Repo-wide guard for known-issues.md: "Cap check that runs before the write evicts for a write
// that adds nothing." A `if (cache.size >= MAX) evictOldest()` in front of `cache.set(key, ...)`
// cannot see whether the key is already held, so at the cap every plain overwrite drops a live
// entry and the cache runs permanently at one entry under its own workload. `cappedSet` in
// boundedCache.ts is the one correct implementation; this file fails when a second copy of the
// shape appears rather than waiting for the next cache to ship with it.
//
// The two spellings are told apart by the comparison, which is not style: a cap checked *before*
// the write is `>= MAX` and needs an explicit `!cache.has(key)` beside it, while a cap checked
// *after* a delete-then-set write is `> MAX` and is already overwrite-safe (re-inserting refreshes
// insertion order, and the size only exceeds the cap when the write genuinely added an entry).
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

const FILES = sourceFiles(SRC_DIR).map((path) => ({
  path: path.slice(SRC_DIR.length),
  text: readFileSync(path, "utf-8"),
}));

// `cappedSet` is the sanctioned home of the shape, and carries the `!cache.has(key)` guard.
const OWNER = "lib/boundedCache.ts";

/**
 * Pre-write cap checks: a `.size >= <cap>` whose eviction (`keys().next()`) follows within three
 * lines. Reports only the ones missing a same-line `.has(` guard, which is the defect.
 */
export function unguardedCapChecks(text: string): { line: number; source: string }[] {
  const lines = text.split("\n");
  const out: { line: number; source: string }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /[A-Za-z_$][\w$.]*\.size\s*>=\s*[A-Za-z_$]/.exec(line);
    if (!match) continue;
    const evicts = lines.slice(index, index + 4).some((l) => l.includes("keys().next()"));
    if (!evicts || line.includes(".has(")) continue;
    out.push({ line: index + 1, source: match[0] });
  }
  return out;
}

describe("capped cache eviction", () => {
  it("reports a cap check that evicts without asking whether the key is already held", () => {
    const owner = FILES.find((file) => file.path === OWNER);
    expect(owner, `${OWNER} must exist for this sweep to mean anything`).toBeDefined();

    expect(unguardedCapChecks(owner!.text), "cappedSet's own check is guarded").toEqual([]);
    expect(unguardedCapChecks(owner!.text.replace("!cache.has(key) && ", ""))).toHaveLength(1);
  });

  it("leaves eviction to cappedSet everywhere outside boundedCache.ts", () => {
    const offenders = FILES.filter((file) => file.path !== OWNER)
      .flatMap((file) => unguardedCapChecks(file.text).map((h) => `${file.path}:${h.line} ${h.source}`))
      .sort();

    expect(offenders, "route size-capped writes through cappedSet()").toEqual([]);
  });
});
