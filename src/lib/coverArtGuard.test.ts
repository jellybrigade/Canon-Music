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

/** Index just past a `'`/`"` literal opening at `open`. */
function endOfQuoted(text: string, open: number): number {
  const quote = text[open];
  let i = open + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** Index just past a template literal opening at `open`, including any `${}` interpolations. */
function endOfTemplate(text: string, open: number): number {
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && text[i + 1] === "{") {
      let braces = 1;
      i += 2;
      while (i < text.length && braces > 0) {
        const inner = text[i];
        if (inner === "`") i = endOfTemplate(text, i);
        else if (inner === '"' || inner === "'") i = endOfQuoted(text, i);
        else {
          if (inner === "{") braces++;
          else if (inner === "}") braces--;
          i++;
        }
      }
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Argument list of every `getCoverArtUrl(...)` call, split on top-level commas. String, template
 * and comment bodies are stepped over rather than scanned: a comma or bracket inside one would
 * otherwise shift every later argument, and the cover id would stop being `args[3]` in exactly
 * the call nobody looked at.
 */
export function callSites(text: string): { line: number; args: string[] }[] {
  const sites: { line: number; args: string[] }[] = [];
  const CALL = /\bgetCoverArtUrl\s*\(/g;
  for (const match of text.matchAll(CALL)) {
    const args: string[] = [];
    let current = "";
    let depth = 0;
    let i = match.index + match[0].length;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "/" && text[i + 1] === "/") {
        const lineEnd = text.indexOf("\n", i);
        i = lineEnd === -1 ? text.length : lineEnd;
        continue;
      }
      if (ch === "/" && text[i + 1] === "*") {
        const blockEnd = text.indexOf("*/", i + 2);
        i = blockEnd === -1 ? text.length : blockEnd + 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        const literalEnd = ch === "`" ? endOfTemplate(text, i) : endOfQuoted(text, i);
        current += text.slice(i, literalEnd);
        i = literalEnd;
        continue;
      }
      if (ch === ")" && depth === 0) break;
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        i++;
        continue;
      }
      current += ch;
      i++;
    }
    if (current.trim()) args.push(current.trim());
    sites.push({ line: text.slice(0, match.index).split("\n").length, args });
  }
  return sites;
}

/**
 * True when `arg` contains a `!` non-null assertion anywhere, not only at its end: the id often
 * reaches the call through a ternary or a `??`, where a trailing-only test sees nothing. `!==`
 * and a leading `!negation` are operators, not assertions.
 */
export function assertsNonNull(arg: string): boolean {
  return /[\w$)\]]!(?!=)/.test(arg);
}

const FILES = sourceFiles(SRC_DIR)
  .map((path) => ({ path: path.slice(SRC_DIR.length), text: readFileSync(path, "utf-8") }))
  .filter(({ path }) => !path.endsWith("clients/navidrome.ts"));

describe("getCoverArtUrl call sites", () => {
  it("finds the call sites at all, so a rename cannot silently empty this sweep", () => {
    const total = FILES.reduce((n, f) => n + callSites(f.text).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it("never asserts the cover art id non-null instead of branching on it", () => {
    const asserted = FILES.flatMap(({ path, text }) =>
      callSites(text)
        .filter((site) => assertsNonNull(site.args[3] ?? ""))
        .map((site) => `${path}:${site.line} ${site.args[3]}`)
    );
    expect(asserted).toEqual([]);
  });
});

describe("the sweep's own reach", () => {
  const coverIdArg = (args: string) => callSites(`getCoverArtUrl(${args})`)[0]?.args[3];

  it("reads the cover id argument past a string, template or comment holding a comma", () => {
    expect(coverIdArg('url, "a,b", auth, id, 300')).toBe("id");
    expect(coverIdArg("url, `a,b`, auth, id, 300")).toBe("id");
    expect(coverIdArg('url, "a(b", auth, id, 300')).toBe("id");
    expect(coverIdArg("url, name /* a,b */, auth, id, 300")).toBe("id");
    expect(coverIdArg("url,\n  name, // a,b\n  auth, id, 300")).toBe("id");
  });

  it("sees an assertion that is not the last character of the argument", () => {
    expect(assertsNonNull("album.coverArt!")).toBe(true);
    expect(assertsNonNull("hasArt ? album.coverArt! : fallback")).toBe(true);
    expect(assertsNonNull('album.coverArt! ?? ""')).toBe(true);
  });

  it("does not read a comparison or a negation as an assertion", () => {
    expect(assertsNonNull("album.coverArt")).toBe(false);
    expect(assertsNonNull("a !== b ? x : y")).toBe(false);
    expect(assertsNonNull("!hasArt ? fallback : id")).toBe(false);
  });
});
