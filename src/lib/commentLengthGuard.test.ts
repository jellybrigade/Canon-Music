// Repo-wide guard for AGENTS.md: "Comments: default none... 1-2 lines." A comment past a
// couple lines is usually WHAT not WHY, or a stale essay. Cap every run at 3 lines; longer
// belongs in ARCHITECTURE.md/known-issues.md instead.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const MAX_COMMENT_RUN = 3;

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

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

// A bare "/**" or "*/" delimiter carries no text of its own; don't charge it against the cap.
function hasContent(line: string): boolean {
  const stripped = line
    .trim()
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .replace(/^\/\//, "")
    .replace(/^\*/, "")
    .trim();
  return stripped.length > 0;
}

export function longCommentRuns(text: string, max = MAX_COMMENT_RUN): number[] {
  const starts: number[] = [];
  let runStart = -1;
  let runLength = 0;
  for (const [index, line] of text.split("\n").entries()) {
    if (COMMENT_LINE.test(line)) {
      if (runLength === 0) runStart = index + 1;
      if (hasContent(line)) runLength++;
    } else {
      if (runLength > max) starts.push(runStart);
      runLength = 0;
    }
  }
  if (runLength > max) starts.push(runStart);
  return starts;
}

// A file that comments most of its lines is gaming the per-run cap with many short
// comments; cap total comment lines at 40% of code lines (min 10, so tiny files have slack).
export function commentDensityExcess(text: string): { comment: number; cap: number } | null {
  const nonBlank = text.split("\n").filter((line) => line.trim().length > 0);
  const comment = nonBlank.filter((line) => COMMENT_LINE.test(line) && hasContent(line)).length;
  const code = nonBlank.length - comment;
  const cap = Math.max(10, Math.ceil(code * 0.4));
  return comment > cap ? { comment, cap } : null;
}

describe("comment length", () => {
  it("passes a two-line comment", () => {
    expect(longCommentRuns("// one\n// two\ncode();")).toEqual([]);
  });

  it("flags a comment run past the cap", () => {
    expect(longCommentRuns("// one\n// two\n// three\n// four\ncode();")).toEqual([1]);
  });

  it("resets the run across non-comment lines", () => {
    const text = "// a\n// b\ncode();\n// c\n// d\ncode();";
    expect(longCommentRuns(text)).toEqual([]);
  });

  it("no source file has a comment run past the cap", () => {
    const violations = FILES.flatMap((file) =>
      longCommentRuns(file.text).map((line) => `${file.path}:${line}`),
    );
    expect(violations).toEqual([]);
  });

  it("flags a file that comments most of its lines", () => {
    const dense = Array.from({ length: 20 }, (_, i) => `// note ${i}\ncode${i}();`).join("\n");
    expect(commentDensityExcess(dense)).not.toBeNull();
    expect(commentDensityExcess("code();\n".repeat(20))).toBeNull();
  });

  it("no source file exceeds the comment density cap", () => {
    const violations = FILES.map((file) => {
      const excess = commentDensityExcess(file.text);
      return excess ? `${file.path}: ${excess.comment} comments, cap ${excess.cap}` : null;
    }).filter((v): v is string => v !== null);
    expect(violations).toEqual([]);
  });
});
