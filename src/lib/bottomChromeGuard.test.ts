// Repo-wide guard for known-issues ui.md: "Fixed bottom chrome is reserved once, by the shell."
// The player bar and status badge are fixed and take no flow space. Each route used to add its
// own padding for them, and Home, Tags and the Unidentified view each got it wrong. The shell now
// gives every route root a bottom margin, so any other reader of the two heights is a second
// reserve (double gap) or a sign someone is hand-rolling one again.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const SHELL_STYLESHEET = "styles/base.css";

function stylesheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...stylesheets(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

export function bottomChromeReads(text: string): number[] {
  const lines: number[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (/var\(\s*--(player-bar-reserve|normalizing-bar-height)\b/.test(line)) lines.push(index + 1);
  }
  return lines;
}

describe("bottom chrome reserve", () => {
  it("finds a read of either height", () => {
    expect(bottomChromeReads("a { padding: 0 0 calc(var(--player-bar-reserve, 0px) + 4px); }\nb {}\nc { top: var(--normalizing-bar-height); }")).toEqual([1, 3]);
  });

  it("is read only by the shell stylesheet", () => {
    const offenders = stylesheets(SRC_DIR)
      .map((path) => ({ path: path.slice(SRC_DIR.length), text: readFileSync(path, "utf-8") }))
      .filter(({ path }) => path !== SHELL_STYLESHEET)
      .flatMap(({ path, text }) => bottomChromeReads(text).map((line) => `${path}:${line}`));
    expect(offenders).toEqual([]);
  });
});
