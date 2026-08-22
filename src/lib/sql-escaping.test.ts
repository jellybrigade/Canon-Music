// Repo-wide guard for known-issues.md: "`ESCAPE '\'` in any template literal or single-quoted TS
// string is `ESCAPE ''` and always throws." That bug is invisible to a per-query test because the
// broken spelling reads correctly in the source; only the *decoded* string is wrong. So this file
// decodes every `ESCAPE '...'` literal in `src/` the way the JS parser would, and asserts it is
// exactly one character - plus it pins which `LIKE ?` sites are allowed to have no ESCAPE clause
// at all, so a new unescaped one fails here rather than over-matching in production.
import BetterSqlite3 from "better-sqlite3";
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

/**
 * Reads a JS single-quoted literal starting at `open` and returns its runtime value, i.e. what
 * SQLite actually receives. `'\\'` (the correct spelling) decodes to one backslash; `'\'` decodes
 * the quote as a literal and runs on to the next quote, which is exactly why the bug is silent
 * in review. Returns null when no closing quote is found.
 */
export function decodeSingleQuoted(source: string, open: number): string | null {
  if (source[open] !== "'") return null;
  let out = "";
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === undefined) return null;
      out += next;
      i++;
      continue;
    }
    if (ch === "'") return out;
    out += ch;
  }
  return null;
}

function escapeLiterals(text: string): string[] {
  const out: string[] = [];
  // Anchored on the quote so the word "ESCAPE" in prose is not read as a SQL literal. A clause
  // whose quote is opened and never closed still decodes to null, which is the case that matters.
  for (const match of text.matchAll(/ESCAPE\s+'/g)) {
    const open = match.index + match[0].length - 1;
    const decoded = decodeSingleQuoted(text, open);
    out.push(decoded ?? "<unterminated>");
  }
  return out;
}

// `LIKE ?` sites that deliberately have no ESCAPE clause, with the reason. Empty as of the pass
// that routed every ownership prefix through `escapeLike`: relying on server ids being
// `crypto.randomUUID()` made the safety incidental rather than designed, and two of the sites
// were DELETEs, so the failure mode was data loss. Adding a site here is a decision; adding one
// by accident fails the test below.
const UNESCAPED_LIKE_EXEMPTIONS = new Set<string>([]);

describe("decodeSingleQuoted", () => {
  // The probe has to be able to fail, so both spellings are asserted here: this is the check that
  // would go red if someone "simplified" the scanner into a regex that reads source text.
  it("decodes the correct spelling to a single backslash", () => {
    expect(decodeSingleQuoted(String.raw`'\\'`, 0)).toBe("\\");
  });

  it("decodes the broken spelling to something that is not a single character", () => {
    // Source chars `'\'` followed by more SQL: the escaped quote is consumed as a literal.
    const broken = String.raw`'\' AND x = 'y'`;
    expect(decodeSingleQuoted(broken, 0)).not.toBe("\\");
    expect(decodeSingleQuoted(broken, 0)?.length).not.toBe(1);
  });

  it("returns null for an unterminated literal", () => {
    expect(decodeSingleQuoted("'abc", 0)).toBeNull();
  });
});

describe("SQL ESCAPE literals across src/", () => {
  it("finds the known ESCAPE sites, so the sweep is not silently matching nothing", () => {
    const total = FILES.reduce((n, f) => n + escapeLiterals(f.text).length, 0);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("decodes every ESCAPE literal to exactly one character", () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const literal of escapeLiterals(file.text)) {
        if (literal.length !== 1) bad.push(`${file.path}: ${JSON.stringify(literal)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives every ESCAPE literal the backslash SQLite expects", () => {
    for (const file of FILES) {
      for (const literal of escapeLiterals(file.text)) {
        expect(literal, file.path).toBe("\\");
      }
    }
  });

  it("SQLite rejects the empty ESCAPE literal the broken spelling produces", () => {
    const raw = new BetterSqlite3(":memory:");
    try {
      expect(() => raw.prepare("SELECT 'a_b' LIKE 'a\\_b' ESCAPE ''").all()).toThrow();
      expect(raw.prepare("SELECT 'a_b' LIKE 'a\\_b' ESCAPE '\\' AS m").get()).toEqual({ m: 1 });
    } finally {
      raw.close();
    }
  });
});

describe("LIKE with a bound parameter carries an ESCAPE clause", () => {
  it("every non-exempt `LIKE ?` site escapes its pattern", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (UNESCAPED_LIKE_EXEMPTIONS.has(file.path)) continue;
      for (const match of file.text.matchAll(/LIKE\s+\?/g)) {
        const tail = file.text.slice(match.index, match.index + 40);
        if (!/ESCAPE/.test(tail)) {
          const line = file.text.slice(0, match.index).split("\n").length;
          offenders.push(`${file.path}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the exemption list names only files that still contain an unescaped `LIKE ?`", () => {
    for (const path of UNESCAPED_LIKE_EXEMPTIONS) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is exempted but no longer exists`).toBeDefined();
      const unescaped = [...(file?.text.matchAll(/LIKE\s+\?/g) ?? [])].filter(
        (m) => !/ESCAPE/.test(file!.text.slice(m.index, m.index + 40))
      );
      expect(unescaped.length, `${path} no longer needs its exemption`).toBeGreaterThan(0);
    }
  });
});
