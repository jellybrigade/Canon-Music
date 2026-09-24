// Repo-wide guard for known-issues.md: "A `var()` naming a token nobody defines computes to the
// property's initial value." `var(--bg-surface)` with no definition makes `background` transparent,
// with no error anywhere, so the start-radio dialog shipped see-through. A fallback only hides the
// same defect behind a literal. Every custom property read must be declared in a stylesheet or set
// from TS (inline `style` objects and `setProperty`, both spelled as a quoted `"--name"`).
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
    } else if (/\.(css|tsx?)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

const FILES = sourceFiles(SRC_DIR).map((path) => ({
  path: path.slice(SRC_DIR.length),
  text: readFileSync(path, "utf-8"),
}));

export function definedTokens(text: string): Set<string> {
  const names = new Set<string>();
  for (const pattern of [/(?<![\w-])(--[\w-]+)\s*:/g, /["'`](--[\w-]+)["'`]/g]) {
    for (const [, name] of text.matchAll(pattern)) if (name) names.add(name);
  }
  return names;
}

export function readTokens(text: string): { line: number; name: string }[] {
  const out: { line: number; name: string }[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const [, name] of line.matchAll(/var\(\s*(--[\w-]+)/g)) if (name) out.push({ line: index + 1, name });
  }
  return out;
}

describe("CSS custom properties", () => {
  it("finds reads with and without a fallback, nested ones included", () => {
    const reads = readTokens("a { color: var(--x); background: var(--y, var(--z, #fff)); }");
    expect(reads.map((read) => read.name)).toEqual(["--x", "--y", "--z"]);
  });

  it("counts stylesheet declarations and TS-set properties as definitions", () => {
    const names = definedTokens(`:root { --a: 1px; } el.style.setProperty("--b", "2"); ({ "--c": x });`);
    expect([...names].sort()).toEqual(["--a", "--b", "--c"]);
  });

  it("does not mistake a read for a definition", () => {
    expect(definedTokens("a { color: var(--x); }").size).toBe(0);
  });

  it("reads no token that nothing defines", () => {
    const defined = new Set(FILES.flatMap((file) => [...definedTokens(file.text)]));
    expect(defined.has("--accent"), "sweep must see tokens.css").toBe(true);
    const undefinedReads = FILES.flatMap((file) =>
      readTokens(file.text)
        .filter((read) => !defined.has(read.name))
        .map((read) => `${file.path}:${read.line} ${read.name}`),
    );
    expect(undefinedReads).toEqual([]);
  });
});
