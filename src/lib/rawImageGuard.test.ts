// Repo-wide guard for known-issues: a chosen album cover only reaches the screen through a new
// URL, and URLs kept in queues and query data were built before the choice. Views that rendered
// their own <img> kept showing the server's cover, so every image goes through CoverImg.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = new Set(["components/CoverImg.tsx"]);

function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...componentFiles(full));
    else if (entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function rawImageLines(text: string): number[] {
  const lines: number[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (/<img\b/.test(line)) lines.push(index + 1);
  }
  return lines;
}

describe("raw image guard", () => {
  it("finds a raw image and passes CoverImg", () => {
    expect(rawImageLines("<CoverImg src={a} />\n<img src={b} />\n<img\n  src={c}")).toEqual([2, 3]);
  });

  it("no view renders an <img> outside CoverImg", () => {
    const hits: string[] = [];
    for (const file of componentFiles(SRC_DIR)) {
      const path = relative(SRC_DIR, file);
      if (ALLOWED.has(path)) continue;
      for (const line of rawImageLines(readFileSync(file, "utf8"))) hits.push(`${path}:${line}`);
    }
    expect(hits).toEqual([]);
  });
});
