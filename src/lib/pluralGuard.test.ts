// Repo-wide guard: a count written beside a hard-coded plural noun reads "1 albums" (Ctrl+K artist
// rows, the Home album total, Last.fm "1 plays"). Every counted noun goes through `plural`, and a
// hand-rolled `=== 1 ?` ternary is the same rule kept by hand, so it goes through `plural` too.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// `{n} albums` in JSX, `${n} albums` in a template, and `n === 1 ? "" : "s"` either way round.
// Any word ending in s after an interpolation, not a list of nouns: a list missed "1 scrobbles".
// An attribute (`xmlns:u=`, `tokens={...}`) is not a count.
const PLURAL_SHAPES = [
  /\}\s+[a-z]{2,}s\b(?![=:])/,
  /=== 1 \? ["'](\w*)["'] : ["']\1e?s["']/,
  /!== 1 \? ["'](\w*)e?s["'] : ["']\1["']/,
];

/** 1-based lines that pluralize a count by hand; comment lines are skipped. */
function handPluralLines(source: string): number[] {
  return source
    .split("\n")
    .flatMap((line, index) =>
      !/^\s*(\/\/|\/?\*)/.test(line) && PLURAL_SHAPES.some((shape) => shape.test(line)) ? [index + 1] : [],
    );
}

describe("counted nouns", () => {
  it("always go through plural", () => {
    const hits = sourceFiles(SRC_DIR).flatMap((path) => {
      const lines = readFileSync(path, "utf-8").split("\n");
      return handPluralLines(lines.join("\n")).map(
        (line) => `${path.slice(SRC_DIR.length)}:${line} ${lines[line - 1]?.trim()}`,
      );
    });
    expect(hits).toEqual([]);
  });
});

describe("the sweep's own reach", () => {
  it("sees a JSX count, a template count and a hand-rolled ternary", () => {
    expect(handPluralLines("<span>{artist.album_count} albums</span>")).toEqual([1]);
    expect(handPluralLines("`Syncing ${done} of ${total} albums`")).toEqual([1]);
    expect(handPluralLines('{n} {n === 1 ? "track" : "tracks"}')).toEqual([1]);
    expect(handPluralLines('node{n === 1 ? "" : "s"}')).toEqual([1]);
    expect(handPluralLines("`${n} item${n !== 1 ? 's' : ''}`")).toEqual([1]);
    expect(handPluralLines("`${formatCount(n)} scrobbles`")).toEqual([1]);
  });

  it("ignores comments and counts routed through plural", () => {
    expect(handPluralLines("// shows {n} albums")).toEqual([]);
    expect(handPluralLines('{n} {plural(n, "album")}')).toEqual([]);
    expect(handPluralLines("{albums.length > 0 && <List />}")).toEqual([]);
    expect(handPluralLines("<MatchedText text={name} tokens={tokens} />")).toEqual([]);
    expect(handPluralLines('{n === 1 ? "Select to confirm:" : "Multiple matches, select one:"}')).toEqual([]);
  });
});
