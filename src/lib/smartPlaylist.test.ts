import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SMART_FILTERS,
  LIMIT_MAX,
  SORT_OPTIONS,
  buildSmartQuery,
  parseSmartFilters,
  type SmartFilters,
} from "./smartPlaylist";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

function filters(over: Partial<SmartFilters> = {}): SmartFilters {
  return { ...DEFAULT_SMART_FILTERS, ...over };
}

describe("parseSmartFilters", () => {
  it("returns null for null, empty and malformed input", () => {
    expect(parseSmartFilters(null)).toBeNull();
    expect(parseSmartFilters("")).toBeNull();
    expect(parseSmartFilters("{not json")).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    expect(parseSmartFilters("[1,2,3]")).toBeNull();
    expect(parseSmartFilters("42")).toBeNull();
    expect(parseSmartFilters("null")).toBeNull();
  });

  it("merges a partial row over the defaults", () => {
    const parsed = parseSmartFilters(JSON.stringify({ limit: 10 }));
    expect(parsed).toEqual({ ...DEFAULT_SMART_FILTERS, limit: 10 });
  });

  it("repairs a legacy row with no selectedGenres or genreMode", () => {
    // An absent genreMode used to read as undefined, which buildSmartQuery treats as
    // "exclude", inverting the user's rule; an absent selectedGenres threw on .length.
    const parsed = parseSmartFilters(JSON.stringify({ name: "Old" }))!;
    expect(parsed.selectedGenres).toEqual([]);
    expect(parsed.genreMode).toBe("include");
  });

  it("replaces a non-array selectedGenres and an unknown genreMode", () => {
    const parsed = parseSmartFilters(
      JSON.stringify({ selectedGenres: "rock", genreMode: "sideways" })
    )!;
    expect(parsed.selectedGenres).toEqual([]);
    expect(parsed.genreMode).toBe("include");
  });

  it("replaces a non-string name", () => {
    expect(parseSmartFilters(JSON.stringify({ name: 7 }))!.name).toBe("");
  });

  it("ignores unknown keys without throwing", () => {
    const parsed = parseSmartFilters(JSON.stringify({ somethingElse: true, limit: 5 }))!;
    expect(parsed.limit).toBe(5);
  });
});

describe("buildSmartQuery", () => {
  it("always scopes to one server and binds the id", () => {
    const { sql, params } = buildSmartQuery(filters(), "srv-1");
    expect(sql).toContain("t.server_id = ?");
    expect(params[0]).toBe("srv-1");
  });

  it("never interpolates a user string into the SQL", () => {
    const evil = "'; DROP TABLE tracks; --";
    const { sql, params } = buildSmartQuery(
      filters({ titleContains: evil, artistContains: evil, albumContains: evil, selectedGenres: [evil] }),
      "srv-1"
    );
    expect(sql).not.toContain("DROP TABLE");
    expect(params.filter((p) => String(p).includes("DROP TABLE")).length).toBe(4);
  });

  it("escapes LIKE wildcards in the bound parameter", () => {
    const { params } = buildSmartQuery(filters({ titleContains: "50%_off" }), "srv-1");
    expect(params[1]).toBe("%50\\%\\_off%");
  });

  it("clamps the limit into 1..LIMIT_MAX", () => {
    expect(buildSmartQuery(filters({ limit: 0 }), "s").sql).toContain("LIMIT 1");
    expect(buildSmartQuery(filters({ limit: -5 }), "s").sql).toContain("LIMIT 1");
    expect(buildSmartQuery(filters({ limit: 99999 }), "s").sql).toContain(`LIMIT ${LIMIT_MAX}`);
  });

  it("emits an ORDER BY for every query, since every query has a LIMIT", () => {
    for (const option of SORT_OPTIONS) {
      const { sql } = buildSmartQuery(filters({ sort: option.value }), "s");
      expect(sql, option.value).toMatch(/ORDER BY .+ LIMIT \d+$/);
    }
  });

  it("joins albums only when an album filter needs it", () => {
    expect(buildSmartQuery(filters(), "s").sql).not.toContain("JOIN albums");
    expect(buildSmartQuery(filters({ albumContains: "Kid" }), "s").sql).toContain("JOIN albums");
  });

  it("uses IN for include mode and NOT IN for exclude mode", () => {
    expect(buildSmartQuery(filters({ selectedGenres: ["rock"] }), "s").sql).toContain(
      "t.album_id IN (SELECT album_id FROM album_genres"
    );
    expect(
      buildSmartQuery(filters({ selectedGenres: ["rock"], genreMode: "exclude" }), "s").sql
    ).toContain("t.album_id NOT IN (SELECT album_id FROM album_genres");
  });

  it("binds one placeholder per selected genre", () => {
    const { sql, params } = buildSmartQuery(
      filters({ selectedGenres: ["rock", "jazz", "funk"] }),
      "s"
    );
    expect(sql).toContain("canonical_id IN (?, ?, ?)");
    expect(params.slice(-3)).toEqual(["rock", "jazz", "funk"]);
  });

  it("omits a year bound that is null", () => {
    const { sql } = buildSmartQuery(filters({ yearFrom: 1990, yearTo: null }), "s");
    expect(sql).toContain("t.year >= ?");
    expect(sql).not.toContain("t.year <= ?");
  });

  it("omits the play count condition at zero", () => {
    expect(buildSmartQuery(filters({ minPlayCount: 0 }), "s").sql).not.toContain("play_count >=");
    expect(buildSmartQuery(filters({ minPlayCount: 3 }), "s").sql).toContain("play_count >= ?");
  });
});

describe("buildSmartQuery against the real schema", () => {
  let db: FakeDatabase;

  beforeAll(async () => {
    db = await createMigratedTestDb();
    await db.execute(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year)
       VALUES ('srv:al1', 'srv', 'navidrome', 'Kid A', 'Radiohead', 2000)`
    );
    for (const [id, title, plays, year] of [
      ["srv:t1", "Everything In Its Right Place", 9, 2000],
      ["srv:t2", "The National Anthem", 0, 2000],
      ["srv:t3", "100% Cotton", 4, 1975],
    ] as const) {
      await db.execute(
        `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, year, play_count)
         VALUES (?, 'srv', 'navidrome', ?, 'Radiohead', 'srv:al1', ?, ?)`,
        [id, title, year, plays]
      );
    }
    await db.execute(
      `INSERT INTO album_genres (album_id, canonical_id, relation, name)
       VALUES ('srv:al1', 'art-rock', 'direct', 'Art Rock')`
    );
  });

  async function run(f: SmartFilters): Promise<string[]> {
    const { sql, params } = buildSmartQuery(f, "srv");
    const rows = await db.select<{ id: string }[]>(sql, params);
    return rows.map((r) => r.id);
  }

  it("runs every sort option as valid SQLite", async () => {
    for (const option of SORT_OPTIONS) {
      await expect(run(filters({ sort: option.value }))).resolves.toBeInstanceOf(Array);
    }
  });

  it("orders by play count descending", async () => {
    expect(await run(filters({ sort: "-playcount" }))).toEqual(["srv:t1", "srv:t3", "srv:t2"]);
  });

  it("treats an escaped percent sign as a literal, not a wildcard", async () => {
    expect(await run(filters({ titleContains: "100%" }))).toEqual(["srv:t3"]);
    // A bare "%" matches only the one title that literally contains a percent sign.
    // Unescaped it would be a wildcard and match all three.
    expect(await run(filters({ titleContains: "%" }))).toEqual(["srv:t3"]);
    expect(await run(filters({ titleContains: "_" }))).toEqual([]);
  });

  it("filters by year range", async () => {
    expect(await run(filters({ yearFrom: 1999, yearTo: 2001 }))).toHaveLength(2);
  });

  it("includes and excludes by genre", async () => {
    expect(await run(filters({ selectedGenres: ["art-rock"] }))).toHaveLength(3);
    expect(await run(filters({ selectedGenres: ["art-rock"], genreMode: "exclude" }))).toEqual([]);
  });

  it("returns nothing for another server's id", async () => {
    const { sql, params } = buildSmartQuery(filters(), "other-server");
    expect(await db.select<{ id: string }[]>(sql, params)).toEqual([]);
  });

  it("honours the clamped limit", async () => {
    expect(await run(filters({ limit: 0, sort: "+title" }))).toHaveLength(1);
  });
});
