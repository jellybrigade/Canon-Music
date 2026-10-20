// Repo-wide guard: virtualized track rows are each their own grid, so a column sized by its
// content gets a different width per row. A 10:00 duration widened its column and shoved the
// genre column left, and a fixed `#` column cut three-digit positions to "1..".
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
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const CONTENT_SIZED = /"(auto|max-content|min-content|fit-content[^"]*)"/;
const FIXED_LITERAL = /^\s*"[\d.]+(rem|px|ch)",?\s*$/;

// The first entry is the `#` column, which has to grow with the row count.
function contentSizedRowColumns(text: string): number[] {
  const lines: number[] = [];
  let entryIndex = -1;
  for (const [index, line] of text.split("\n").entries()) {
    if (/gridTemplate\w* = \[/.test(line)) entryIndex = 0;
    else if (entryIndex >= 0 && /^\s*\]/.test(line)) entryIndex = -1;
    else if (entryIndex >= 0) {
      if (CONTENT_SIZED.test(line) || (entryIndex === 0 && FIXED_LITERAL.test(line))) lines.push(index + 1);
      entryIndex++;
    }
  }
  return lines;
}

describe("per-row grid columns", () => {
  it("finds content-sized columns and a fixed-width number column", () => {
    expect(
      contentSizedRowColumns(
        [
          "const gridTemplate = [",
          '  "2.5rem",',
          '  "minmax(0, 2fr)",',
          '  cols.year ? "3.5rem" : null,',
          '  cols.duration ? "auto" : null,',
          "]",
          'const other = ["auto"];',
          "const gridTemplate = [",
          "  trackNumberColumn(tracks.length),",
          '  cols.duration ? "max-content" : null,',
          "]",
        ].join("\n"),
      ),
    ).toEqual([2, 5, 10]);
  });

  it("never sizes a track row column by its own content", () => {
    const offenders = sources(SRC_DIR).flatMap((path) =>
      contentSizedRowColumns(readFileSync(path, "utf-8")).map((line) => `${path.slice(SRC_DIR.length)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
