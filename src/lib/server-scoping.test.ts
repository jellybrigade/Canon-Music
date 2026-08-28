// Repo-wide guard for known-issues.md: "A read of a mirrored table keyed on an artist name is not
// scoped to the selected server, and the name carries no server prefix to make it one." An id-keyed
// read is at least unambiguous; a name-keyed one genuinely returns a second server's rows, and every
// consumer builds its cover and stream URLs from the *selected* server's credential, so the foreign
// rows paint broken art and cannot play. A per-query test cannot see the next one someone writes, so
// this file sweeps every SQL literal in `src/` and pins the reads allowed to stay unscoped.
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

const MIRROR_READ = /`([^`]*\bSELECT\b[^`]*\b(?:FROM|JOIN)\s+(?:albums|tracks)\b[^`]*)`/gs;
const ARTIST_FILTER = /\b\w*\.?artist\s*(?:=\s*\?|IN\s*\(|LIKE\s*\?)/;
const SERVER_SCOPE = /\bserver_id\s*=\s*\?/;

export interface UnscopedRead {
  path: string;
  line: number;
  sql: string;
}

export function unscopedArtistReads(path: string, text: string): UnscopedRead[] {
  const out: UnscopedRead[] = [];
  for (const match of text.matchAll(MIRROR_READ)) {
    const sql = match[1] ?? "";
    if (!ARTIST_FILTER.test(sql) || SERVER_SCOPE.test(sql)) continue;
    out.push({ path, line: text.slice(0, match.index).split("\n").length, sql });
  }
  return out;
}

/**
 * Name-keyed reads that may stay library-wide, with the reason. Both resolve a *global* identity
 * rather than something the user plays: neither row reaches a cover or stream URL, and an artist's
 * MusicBrainz id is the same fact whichever server holds the albums that evidence it. Adding a file
 * here is a decision about that specific consequence, not a way to quiet the sweep.
 */
const LIBRARY_WIDE_BY_DESIGN = new Set<string>([
  "hooks/useAlbumIdentity.ts",
  "hooks/useEnrichArtist.ts",
]);

describe("artist-name reads of the mirror are scoped to one server", () => {
  it("finds the known mirror reads, so the sweep is not silently matching nothing", () => {
    const total = FILES.reduce((n, f) => n + [...f.text.matchAll(MIRROR_READ)].length, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("recognises an unscoped read and clears a scoped one", () => {
    const unscoped = "const q = `SELECT id FROM albums WHERE artist = ?`;";
    const scoped = "const q = `SELECT id FROM albums WHERE server_id = ? AND artist = ?`;";
    expect(unscopedArtistReads("x.ts", unscoped)).toHaveLength(1);
    expect(unscopedArtistReads("x.ts", scoped)).toEqual([]);
  });

  it("every non-exempt artist-name read carries its server scope", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (LIBRARY_WIDE_BY_DESIGN.has(file.path)) continue;
      for (const read of unscopedArtistReads(file.path, file.text)) {
        offenders.push(`${read.path}:${read.line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the exemption list names only files that still hold an unscoped artist read", () => {
    for (const path of LIBRARY_WIDE_BY_DESIGN) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is exempted but no longer exists`).toBeDefined();
      expect(
        unscopedArtistReads(path, file?.text ?? "").length,
        `${path} no longer needs its exemption`
      ).toBeGreaterThan(0);
    }
  });
});
