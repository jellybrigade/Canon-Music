// Repo-wide guard: a bare `1fr` track is `minmax(auto, 1fr)`, so it never shrinks below its
// content. Playlist cards with long one-line names widened their column, and their square art
// with it, so equal columns are always written `minmax(0, 1fr)`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.(css|tsx?)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const BARE_FR_COLUMNS = /(grid-template-columns:|gridTemplateColumns:)\s*["'`]?1fr(\s+1fr)*["'`]?\s*[;,}]/;

function contentSizedColumns(text: string): number[] {
  const lines: number[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (/repeat\([^()]*(\([^()]*\)[^()]*)*,\s*1fr\s*\)/.test(line) || BARE_FR_COLUMNS.test(line)) lines.push(index + 1);
  }
  return lines;
}

describe("equal grid columns", () => {
  it("finds a repeat of bare 1fr tracks", () => {
    expect(
      contentSizedColumns(
        "a { grid-template-columns: repeat(3, 1fr); }\ngridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,\ngridTemplateColumns: `repeat(${cols}, 1fr)`,\nb { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }",
      ),
    ).toEqual([1, 3]);
  });

  it("finds bare 1fr columns written out", () => {
    expect(
      contentSizedColumns(
        "a { grid-template-columns: 1fr; }\nb { grid-template-columns: 1fr 1fr; }\nc { grid-template-columns: minmax(0, 1fr); }\nd { grid-template-columns: auto 1fr; }",
      ),
    ).toEqual([1, 2]);
  });

  it("never lets content widen a column", () => {
    const offenders = sources(SRC_DIR).flatMap((path) =>
      contentSizedColumns(readFileSync(path, "utf-8")).map((line) => `${path.slice(SRC_DIR.length)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
