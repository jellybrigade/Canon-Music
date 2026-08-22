import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { escapeLike } from "./sql";

describe("escapeLike", () => {
  it("leaves a value with no LIKE metacharacter untouched", () => {
    expect(escapeLike("6f1a2b3c-4d5e")).toBe("6f1a2b3c-4d5e");
  });

  it("escapes the single-character wildcard", () => {
    expect(escapeLike("music_1")).toBe("music\\_1");
  });

  it("escapes the multi-character wildcard", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes the escape character itself, so it cannot smuggle in a wildcard", () => {
    expect(escapeLike("a\\_b")).toBe("a\\\\\\_b");
  });

  it("escapes every occurrence, not only the first", () => {
    expect(escapeLike("a_b_c%d")).toBe("a\\_b\\_c\\%d");
  });

  it("passes the empty string through", () => {
    expect(escapeLike("")).toBe("");
  });
});

// The unit assertions above pin the *spelling*; these pin the thing that actually matters, which
// is that SQLite then matches literally. Without them a "correct-looking" escaper that emits the
// wrong number of backslashes would still pass.
describe("escapeLike against real SQLite", () => {
  function matches(pattern: string, ...values: string[]): number[] {
    const raw = new BetterSqlite3(":memory:");
    try {
      raw.exec("CREATE TABLE t (v TEXT)");
      const insert = raw.prepare("INSERT INTO t (v) VALUES (?)");
      for (const v of values) insert.run(v);
      const rows = raw
        .prepare("SELECT rowid FROM t WHERE v LIKE ? ESCAPE '\\'")
        .all(pattern) as { rowid: number }[];
      return rows.map((r) => r.rowid);
    } finally {
      raw.close();
    }
  }

  it("stops an underscore in the prefix matching a sibling id", () => {
    // The live shape: two servers differing only where the underscore sits. Unescaped, each
    // prefix matches the other's rows, and the loved-stage DELETEs are scoped by exactly this.
    const pattern = `${escapeLike("music_1")}:%`;
    expect(matches(pattern, "music_1:track", "music-1:track")).toEqual([1]);
  });

  it("stops a percent in the prefix matching every id", () => {
    const pattern = `${escapeLike("100%")}:%`;
    expect(matches(pattern, "100%:track", "100abc:track")).toEqual([1]);
  });

  it("still matches everything under the prefix it does own", () => {
    const pattern = `${escapeLike("music_1")}:%`;
    expect(matches(pattern, "music_1:a", "music_1:b")).toEqual([1, 2]);
  });

  it("proves the probe can fail: the unescaped prefix over-matches", () => {
    expect(matches("music_1:%", "music_1:track", "music-1:track")).toEqual([1, 2]);
  });
});
