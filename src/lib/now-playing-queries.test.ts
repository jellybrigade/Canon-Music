import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./lastfm", () => ({
  fetchArtistTopTracks: vi.fn(async () => []),
  fetchSimilarArtists: vi.fn(async () => []),
}));

import { getDb } from "../db";
import { fetchArtistTopTracks } from "./lastfm";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { fetchArtistTopTracksForNowPlaying, primaryArtistOf } from "./now-playing-queries";

describe("primaryArtistOf", () => {
  it("returns null for null, undefined, and empty string", () => {
    expect(primaryArtistOf(null)).toBeNull();
    expect(primaryArtistOf(undefined)).toBeNull();
    expect(primaryArtistOf("")).toBeNull();
  });

  it("strips a 'feat.' suffix", () => {
    expect(primaryArtistOf("Burial feat. Four Tet")).toBe("Burial");
  });

  it("strips a 'ft.' suffix", () => {
    expect(primaryArtistOf("Burial ft. Four Tet")).toBe("Burial");
  });

  it("strips a 'featuring' suffix", () => {
    expect(primaryArtistOf("Burial featuring Four Tet")).toBe("Burial");
  });

  it("matches the feat. keyword case-insensitively", () => {
    expect(primaryArtistOf("Burial FEAT. Four Tet")).toBe("Burial");
  });

  it("does not split on '&' or ',' - only feat./ft./featuring are handled", () => {
    expect(primaryArtistOf("X & Y")).toBe("X & Y");
    expect(primaryArtistOf("X, Y")).toBe("X, Y");
  });

  it("returns the original string unchanged when there is no feat. keyword", () => {
    expect(primaryArtistOf("Radiohead")).toBe("Radiohead");
  });

  it("cuts at the first feat. keyword when there are multiple", () => {
    expect(primaryArtistOf("A feat. B feat. C")).toBe("A");
  });

  it("does not trim surrounding whitespace", () => {
    expect(primaryArtistOf("  Burial  ")).toBe("  Burial  ");
  });
});

// known-issues.md, same entry as the parity block below: the feat.-variant artist match at
// now-playing-queries.ts:66-68 shipped once with a broken `ESCAPE '\'` (an empty SQL literal,
// which SQLite rejects at prepare time). These tests exercise the real clause against real
// SQLite with artist names that contain the LIKE metacharacters, so both halves of the pairing
// are pinned: the ESCAPE clause has to be present *and* escapeLike has to escape \ % and _.
describe("fetchArtistTopTracksForNowPlaying: LIKE escaping in the feat.-variant match", () => {
  let db: FakeDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await createMigratedTestDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    // Empty Last.fm response takes the fallback branch, which runs the same `artistMatch`
    // fragment as the intersected branch - one select, no ranking noise in the assertions.
    vi.mocked(fetchArtistTopTracks).mockResolvedValue([]);
  });

  function seed(...artists: string[]): void {
    artists.forEach((artist, i) => {
      db.raw
        .prepare(
          `INSERT INTO tracks (id, server_id, server_type, title, artist, track_number)
           VALUES (?, 'srv', 'navidrome', ?, ?, ?)`
        )
        .run(`srv:t${i}`, `Title ${i}`, artist, i);
    });
  }

  async function artistsFor(name: string): Promise<string[]> {
    const rows = await fetchArtistTopTracksForNowPlaying(name);
    return rows.map((r) => r.artist ?? "");
  }

  it("treats an underscore in the artist name as a literal, not a single-char wildcard", async () => {
    seed("A_C", "A_C feat. Guest", "ABC feat. Other");
    expect(await artistsFor("A_C")).toEqual(["A_C", "A_C feat. Guest"]);
  });

  it("treats a percent sign in the artist name as a literal, not a multi-char wildcard", async () => {
    seed("100%", "100% feat. Guest", "1000 feat. Other");
    expect(await artistsFor("100%")).toEqual(["100%", "100% feat. Guest"]);
  });

  it("matches an artist whose name contains a backslash", async () => {
    seed("AC\\DC", "AC\\DC feat. Guest", "ACXDC feat. Other");
    expect(await artistsFor("AC\\DC")).toEqual(["AC\\DC", "AC\\DC feat. Guest"]);
  });

  it("does not leave a dangling escape character for a name ending in a backslash", async () => {
    seed("Trailing\\", "Trailing\\ feat. Guest");
    expect(await artistsFor("Trailing\\")).toEqual(["Trailing\\", "Trailing\\ feat. Guest"]);
  });

  it("matches all three collaboration spellings and nothing that merely starts with the name", async () => {
    seed(
      "Burial",
      "Burial feat. Four Tet",
      "Burial ft. Four Tet",
      "Burial featuring Four Tet",
      "Burialist feat. Someone",
      "Burial Mix"
    );
    expect(await artistsFor("Burial")).toEqual([
      "Burial",
      "Burial feat. Four Tet",
      "Burial ft. Four Tet",
      "Burial featuring Four Tet",
    ]);
  });

  it("matches a bare 'feat.' but needs the space the 'featuring' pattern spells out", async () => {
    // The patterns are asymmetric: `feat.%` and `ft.%` have no space before the wildcard, so a
    // guest-less "Burial feat." matches; `featuring %` does, so "Burial featuring" misses while
    // "Burial featuring " (trailing space, empty guest) matches.
    seed("Burial feat.", "Burial featuring", "Burial featuring ");
    expect(await artistsFor("Burial")).toEqual(["Burial feat.", "Burial featuring "]);
  });

  it("runs the escaped query for an empty artist name without matching everything", async () => {
    seed("Burial", "");
    expect(await artistsFor("")).toEqual([""]);
  });
});

describe("regression: prefetch/consumer key parity", () => {
  // known-issues.md: "A prefetch that duplicates a query instead of sharing it warms a key
  // nobody reads" - useNowPlayingPrefetch used to hold its own copy of NowPlayingView's query
  // fns/keys/staleTime, keyed on the raw artist name instead of primaryArtistOf's stripped one,
  // so "X feat. Y" tracks never hit their own prefetch. A component-mount test can't see an
  // import statement; asserting on the source text is what actually catches a reintroduced copy.
  const sharedExports = [
    "primaryArtistOf",
    "fetchArtistAlbums",
    "fetchArtistTopTracksForNowPlaying",
    "fetchSuggestedTracksForNowPlaying",
    "NOW_PLAYING_STALE_TIME",
    "SUGGESTED_STALE_TIME",
  ];

  function importsSharedModule(source: string): boolean {
    const match = source.match(/import\s*{([^}]+)}\s*from\s*["'].*now-playing-queries["']/);
    const captured = match?.[1];
    if (!captured) return false;
    const named = captured.split(",").map((s) => s.trim());
    return sharedExports.every((name) => named.includes(name));
  }

  it("useNowPlayingPrefetch imports every query building block from the shared module", () => {
    const source = readFileSync(new URL("../hooks/useNowPlayingPrefetch.ts", import.meta.url), "utf-8");
    expect(importsSharedModule(source)).toBe(true);
  });

  it("NowPlayingView imports the same building blocks, not a local re-declaration", () => {
    const source = readFileSync(new URL("../components/NowPlayingView.tsx", import.meta.url), "utf-8");
    expect(importsSharedModule(source)).toBe(true);
  });

  it("neither consumer hardcodes its own numeric staleTime for these queries", () => {
    const prefetch = readFileSync(new URL("../hooks/useNowPlayingPrefetch.ts", import.meta.url), "utf-8");
    const view = readFileSync(new URL("../components/NowPlayingView.tsx", import.meta.url), "utf-8");
    for (const source of [prefetch, view]) {
      const staleTimeValues = [...source.matchAll(/staleTime:\s*([^,\n]+)/g)].map((m) => (m[1] ?? "").trim());
      for (const value of staleTimeValues) {
        expect(value).toMatch(/^(NOW_PLAYING_STALE_TIME|SUGGESTED_STALE_TIME)$/);
      }
    }
  });
});
