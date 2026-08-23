// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { QK } from "../lib/query-keys";
import { useSearch, type SearchResults } from "./useSearch";

const SRV = "srv-a";
const OTHER = "srv-b";

let db: FakeDatabase;

/**
 * `tracks_fts` has no triggers (see `migrations.ts` v5) - `sync.ts` writes it explicitly, so
 * seeding `tracks` alone leaves the index empty and every search returns nothing. These helpers
 * mirror what `sync.ts:504` actually inserts, including its COALESCE of NULL artist/genre to ''
 * and its copy of `albums.name` into the `album` column.
 */
function seedAlbum(opts: {
  id: string;
  serverId?: string;
  name: string;
  artist?: string | null;
  artworkUrl?: string | null;
}) {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, artwork_url)
       VALUES (?, ?, 'navidrome', ?, ?, ?)`
    )
    .run(opts.id, opts.serverId ?? SRV, opts.name, opts.artist ?? null, opts.artworkUrl ?? null);
}

function seedTrack(opts: {
  id: string;
  serverId?: string;
  title: string;
  artist?: string | null;
  albumId: string | null;
  genre?: string | null;
  duration?: number | null;
  /** Album name written into the FTS row; defaults to the seeded album's name. */
  ftsAlbum?: string;
  /** Skip the FTS row entirely - for asserting a track is invisible to search. */
  noFts?: boolean;
}) {
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, genre, duration)
       VALUES (?, ?, 'navidrome', ?, ?, ?, ?, ?)`
    )
    .run(
      opts.id,
      opts.serverId ?? SRV,
      opts.title,
      opts.artist ?? null,
      opts.albumId,
      opts.genre ?? null,
      opts.duration ?? null
    );
  if (opts.noFts) return;
  const albumName =
    opts.ftsAlbum ??
    (opts.albumId
      ? ((db.raw.prepare(`SELECT name FROM albums WHERE id = ?`).get(opts.albumId) as
          | { name: string }
          | undefined)?.name ?? "")
      : "");
  db.raw
    .prepare(`INSERT INTO tracks_fts (id, title, artist, album, genre) VALUES (?, ?, ?, ?, ?)`)
    .run(opts.id, opts.title, opts.artist ?? "", albumName, opts.genre ?? "");
}

/** One album plus one track on it, the common fixture shape. */
function seedPair(opts: {
  key: string;
  albumName: string;
  trackTitle: string;
  artist?: string | null;
  serverId?: string;
  genre?: string | null;
  albumArtist?: string | null;
}) {
  seedAlbum({
    id: `${opts.key}-alb`,
    serverId: opts.serverId,
    name: opts.albumName,
    artist: opts.albumArtist === undefined ? (opts.artist ?? null) : opts.albumArtist,
  });
  seedTrack({
    id: `${opts.key}-trk`,
    serverId: opts.serverId,
    title: opts.trackTitle,
    artist: opts.artist ?? null,
    albumId: `${opts.key}-alb`,
    genre: opts.genre ?? null,
  });
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** Runs the hook to a settled state and hands back the result rows. */
async function search(
  query: string,
  serverId: string | undefined = SRV,
  client: QueryClient = makeClient()
): Promise<SearchResults> {
  const { result } = renderHook(() => useSearch(query, serverId), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return result.current.data!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedTestDb();
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
});

afterEach(async () => {
  await db.close();
});

describe("useSearch FTS pool ranking and caps", () => {
  // Regression, known-issues "A LIMIT without ORDER BY silently redefines what the query
  // returns": the pool used to be a bare LIMIT, so FTS5 rowid order kept the oldest-synced
  // rows. The exact match is inserted last here, i.e. it has the highest rowid and would be
  // the first thing an unordered cap throws away.
  it("keeps an exact title match that a rowid-ordered cap would have dropped", async () => {
    seedAlbum({ id: "bulk-alb", name: "Bulk Album" });
    const insertTrack = db.raw.prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, genre)
       VALUES (?, ?, 'navidrome', ?, 'Filler', 'bulk-alb', NULL)`
    );
    const insertFts = db.raw.prepare(
      `INSERT INTO tracks_fts (id, title, artist, album, genre) VALUES (?, ?, 'Filler', 'Bulk Album', '')`
    );
    db.raw.transaction(() => {
      for (let i = 0; i < 2100; i++) {
        const title = `Lovely Filler ${i}`;
        insertTrack.run(`f${i}`, SRV, title);
        insertFts.run(`f${i}`, title);
      }
      insertTrack.run("exact", SRV, "Love");
      insertFts.run("exact", "Love");
    })();

    const res = await search("love");

    expect(res.tracks.some(t => t.id === "exact")).toBe(true);
    expect(res.tracks[0]!.id).toBe("exact");
  });

  it("ranks a title hit above a hit that only matched the genre column", async () => {
    seedPair({ key: "t", albumName: "A", trackTitle: "Jazz Hands", artist: "X" });
    seedPair({ key: "g", albumName: "B", trackTitle: "Jazz Standard", artist: "Y", genre: "jazz" });

    const res = await search("jazz hands");

    expect(res.tracks.map(t => t.id)).toEqual(["t-trk"]);
  });

  // MATERIALIZED cannot be proven by executing the un-materialized variant: on SQLite 3.53 the
  // inner ORDER BY/LIMIT blocks flattening anyway, so the flattened form does not throw. The
  // durable assertion is on the SQL actually issued.
  it("issues all three section queries with a MATERIALIZED bm25 CTE ordered before its cap", async () => {
    seedPair({ key: "a", albumName: "Album", trackTitle: "Song", artist: "Artist" });

    await search("song");

    const selects = db.queryLog.filter(q => q.kind === "select").map(q => q.sql);
    expect(selects).toHaveLength(3);
    for (const sql of selects) {
      expect(sql).toContain("WITH ranked AS MATERIALIZED");
      expect(sql).toContain("bm25(tracks_fts, 0.0, 10.0, 8.0, 4.0, 1.0)");
      // Every LIMIT in the statement is preceded by an ORDER BY.
      const parts = sql.split(/\bLIMIT\b/);
      expect(parts).toHaveLength(3);
      for (const before of parts.slice(0, -1)) expect(before).toMatch(/ORDER BY/);
    }
  });

  it("runs the three section queries concurrently rather than one after another", async () => {
    seedPair({ key: "a", albumName: "Album", trackTitle: "Song", artist: "Artist" });
    const inner = db.select.bind(db);
    let inFlight = 0;
    let peak = 0;
    db.select = (async (sql: string, params?: unknown[]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      const rows = await inner(sql, params);
      inFlight--;
      return rows;
    }) as typeof db.select;

    await search("song");

    expect(peak).toBe(3);
  });
});

describe("useSearch server scoping", () => {
  it("excludes albums, tracks and artists owned by another server", async () => {
    seedPair({ key: "mine", albumName: "Blue Album", trackTitle: "Blue Song", artist: "Blue Artist" });
    seedPair({
      key: "theirs",
      albumName: "Blue Record",
      trackTitle: "Blue Tune",
      artist: "Blue Person",
      serverId: OTHER,
    });

    const res = await search("blue");

    expect(res.albums.map(a => a.id)).toEqual(["mine-alb"]);
    expect(res.tracks.map(t => t.id)).toEqual(["mine-trk"]);
    expect(res.artists.map(a => a.name)).toEqual(["Blue Artist"]);
  });

  // Regression, known-issues "A mirror not scoped by owner": the shipped bug was call sites
  // building `SearchAlbum`/`AlbumRow` with `server_id: server.id` (the *selected* server) rather
  // than the row's own column. Here the album row's owner deliberately disagrees with the id
  // being queried, so a reconstructed value would read `srv-a` and this fails.
  it("reads server_id off the album row itself, not off the queried server", async () => {
    seedAlbum({ id: "odd-alb", serverId: OTHER, name: "Odd Album" });
    // The album belongs to OTHER, so the album section (filtered on a.server_id) drops it.
    seedTrack({ id: "odd-trk", serverId: SRV, title: "Odd Song", artist: "Odd", albumId: "odd-alb" });
    seedPair({ key: "same", albumName: "Odd Sibling", trackTitle: "Odd Sibling Song", artist: "Odd" });

    const mine = await search("odd", SRV);
    expect(mine.albums.map(a => [a.id, a.server_id])).toEqual([["same-alb", SRV]]);

    const theirs = await search("odd", OTHER, makeClient());
    expect(theirs.albums.map(a => [a.id, a.server_id])).toEqual([["odd-alb", OTHER]]);
  });

  it("reads server_id off the track row itself", async () => {
    seedAlbum({ id: "shared-alb", serverId: OTHER, name: "Shared Album" });
    seedTrack({ id: "mine-trk", serverId: SRV, title: "Grey Song", artist: "Grey", albumId: "shared-alb" });
    seedTrack({ id: "their-trk", serverId: OTHER, title: "Grey Tune", artist: "Grey", albumId: "shared-alb" });

    const res = await search("grey");

    expect(res.tracks.map(t => [t.id, t.server_id])).toEqual([["mine-trk", SRV]]);
  });

  it("refetches for the other server when only serverId changes", async () => {
    seedPair({ key: "mine", albumName: "Red Album", trackTitle: "Red Song", artist: "Red One" });
    seedPair({
      key: "theirs",
      albumName: "Red Record",
      trackTitle: "Red Tune",
      artist: "Red Two",
      serverId: OTHER,
    });
    const client = makeClient();

    const { result, rerender } = renderHook(
      ({ serverId }: { serverId: string }) => useSearch("red", serverId),
      { wrapper: wrapperFor(client), initialProps: { serverId: SRV } }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.tracks.map(t => t.id)).toEqual(["mine-trk"]);

    rerender({ serverId: OTHER });
    await waitFor(() => expect(result.current.data!.tracks.map(t => t.id)).toEqual(["theirs-trk"]));
  });
});

describe("useSearch row shape and joins", () => {
  it("returns a track whose album row is missing with null album fields, and no album row for it", async () => {
    seedTrack({ id: "orphan", title: "Orphan Song", artist: "Nobody", albumId: "gone-alb", ftsAlbum: "" });

    const res = await search("orphan");

    expect(res.tracks).toHaveLength(1);
    expect(res.tracks[0]!.album_id).toBe("gone-alb");
    expect(res.tracks[0]!.album_name).toBeNull();
    expect(res.tracks[0]!.artwork_url).toBeNull();
    expect(res.albums).toEqual([]);
  });

  it("omits a track with no artist from the artist section while keeping it in tracks", async () => {
    seedAlbum({ id: "n-alb", name: "Nameless Album" });
    seedTrack({ id: "n-trk", title: "Nameless Song", artist: null, albumId: "n-alb" });

    const res = await search("nameless");

    expect(res.tracks.map(t => t.id)).toEqual(["n-trk"]);
    expect(res.tracks[0]!.artist).toBeNull();
    expect(res.artists).toEqual([]);
  });

  it("counts distinct albums per artist rather than tracks", async () => {
    seedAlbum({ id: "c1", name: "Coral One", artist: "Coral" });
    seedAlbum({ id: "c2", name: "Coral Two", artist: "Coral" });
    seedTrack({ id: "c1a", title: "Coral A", artist: "Coral", albumId: "c1" });
    seedTrack({ id: "c1b", title: "Coral B", artist: "Coral", albumId: "c1" });
    seedTrack({ id: "c2a", title: "Coral C", artist: "Coral", albumId: "c2" });

    const res = await search("coral");

    expect(res.artists).toHaveLength(1);
    expect(res.artists[0]!.album_count).toBe(2);
  });

  it("collapses many matching tracks on one album into a single album row", async () => {
    seedAlbum({ id: "one-alb", name: "Amber Album", artist: "Amber" });
    seedTrack({ id: "a1", title: "Amber I", artist: "Amber", albumId: "one-alb" });
    seedTrack({ id: "a2", title: "Amber II", artist: "Amber", albumId: "one-alb" });
    seedTrack({ id: "a3", title: "Amber III", artist: "Amber", albumId: "one-alb" });

    const res = await search("amber");

    expect(res.albums.map(a => a.id)).toEqual(["one-alb"]);
    expect(res.tracks).toHaveLength(3);
  });

  it("fills artist image columns from artist_identity and leaves them null without a row", async () => {
    seedPair({ key: "pic", albumName: "Ivory Album", trackTitle: "Ivory Song", artist: "Ivory Known" });
    seedPair({ key: "nopic", albumName: "Ivory Other", trackTitle: "Ivory Tune", artist: "Ivory Unknown" });
    db.raw
      .prepare(
        `INSERT INTO artist_identity (artist_name, lastfm_image_url, wikidata_image_url, navidrome_image_url)
         VALUES ('Ivory Known', 'lf.jpg', 'wd.jpg', 'nd.jpg')`
      )
      .run();

    const res = await search("ivory");
    const known = res.artists.find(a => a.name === "Ivory Known")!;
    const unknown = res.artists.find(a => a.name === "Ivory Unknown")!;

    expect([known.lastfm_image_url, known.wikidata_image_url, known.navidrome_image_url]).toEqual([
      "lf.jpg",
      "wd.jpg",
      "nd.jpg",
    ]);
    expect([unknown.lastfm_image_url, unknown.wikidata_image_url, unknown.navidrome_image_url]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("passes replay-gain columns through unchanged, nulls included", async () => {
    seedPair({ key: "rg", albumName: "Gain Album", trackTitle: "Gain Song", artist: "Gain" });
    db.raw
      .prepare(
        `UPDATE tracks SET replay_gain_track_gain = -7.5, replay_gain_track_peak = 0.98 WHERE id = 'rg-trk'`
      )
      .run();

    const res = await search("gain song");

    expect(res.tracks[0]!.replay_gain_track_gain).toBe(-7.5);
    expect(res.tracks[0]!.replay_gain_track_peak).toBe(0.98);
    expect(res.tracks[0]!.replay_gain_album_gain).toBeNull();
    expect(res.tracks[0]!.replay_gain_album_peak).toBeNull();
  });
});

describe("useSearch query parsing", () => {
  it("requires every token to match, not just one", async () => {
    seedPair({ key: "both", albumName: "Both Album", trackTitle: "Love Song", artist: "A" });
    seedPair({ key: "one", albumName: "One Album", trackTitle: "Love", artist: "B" });

    const res = await search("love song");

    expect(res.tracks.map(t => t.id)).toEqual(["both-trk"]);
  });

  it("matches on a prefix of a word", async () => {
    seedPair({ key: "p", albumName: "Prefix Album", trackTitle: "Lovely Day", artist: "P" });

    const res = await search("lov");

    expect(res.tracks.map(t => t.id)).toEqual(["p-trk"]);
  });

  it("ignores surrounding whitespace", async () => {
    seedPair({ key: "w", albumName: "Whitespace Album", trackTitle: "Love Song", artist: "W" });

    const res = await search("  love song  ");

    expect(res.tracks.map(t => t.id)).toEqual(["w-trk"]);
  });

  // Pinned as current behavior, not endorsed: `toFtsQuery` collapses interior runs of
  // whitespace, but `scoreMatch` compares the *raw* query string, so "love  song" scores 0
  // against "Love Song" and every FTS hit is filtered back out. Logged in donow.md.
  it("returns nothing when interior whitespace is doubled, despite the index matching", async () => {
    seedPair({ key: "w", albumName: "Whitespace Album", trackTitle: "Love Song", artist: "W" });

    const res = await search("love  song");

    expect(res.tracks).toEqual([]);
    expect(res.albums).toEqual([]);
  });

  it("treats FTS5 operator words as literal tokens, not operators", async () => {
    seedPair({ key: "n", albumName: "Not Album", trackTitle: "Love Song", artist: "N" });

    // Parsed as an operator this would exclude "song"; quoted, it is a third required token.
    const res = await search("love NOT song");

    expect(res.tracks).toEqual([]);
  });

  // Same split as the whitespace case: the quote is stripped for FTS (so the index does match
  // "Hello There" and the query does not blow up on unbalanced syntax) but `scoreMatch` sees the
  // raw `he"llo` and scores 0, so the row is filtered out again. Pinned, logged in donow.md.
  it("strips double quotes for the index without throwing, though scoring still drops the row", async () => {
    seedPair({ key: "q", albumName: "Quote Album", trackTitle: "Hello There", artist: "Q" });

    const res = await search('he"llo');

    expect(
      db.raw.prepare(`SELECT COUNT(*) c FROM tracks_fts WHERE tracks_fts MATCH '"hello"*'`).get()
    ).toEqual({ c: 1 });
    expect(res.tracks).toEqual([]);
  });

  it("returns empty for a punctuation-only query rather than failing the query", async () => {
    seedPair({ key: "p", albumName: "Punct Album", trackTitle: "Love Song", artist: "P" });

    const res = await search("% * ()");

    expect(res).toEqual({ albums: [], tracks: [], artists: [] });
  });
});

describe("useSearch relevance re-ranking", () => {
  it("orders exact over starts-with over word-starts-with over substring", async () => {
    // All four sit on an album named "Halo Album", so the substring-tier row reaches the FTS
    // pool through the album column - a prefix index cannot find "halo" inside "Michalo".
    seedAlbum({ id: "tier-alb", name: "Halo Album", artist: "Tier" });
    seedTrack({ id: "exact", title: "Halo", artist: "Tier", albumId: "tier-alb" });
    seedTrack({ id: "starts", title: "Halo Effect", artist: "Tier", albumId: "tier-alb" });
    seedTrack({ id: "word", title: "The Halo Effect", artist: "Tier", albumId: "tier-alb" });
    seedTrack({ id: "sub", title: "Michalo", artist: "Tier", albumId: "tier-alb" });

    const res = await search("halo");

    expect(res.tracks.map(t => t.id)).toEqual(["exact", "starts", "word", "sub"]);
  });

  it("weights an artist match at 0.6 of the equivalent title match", async () => {
    seedAlbum({ id: "w-alb", name: "Weight Album", artist: "Weight" });
    // Artist starts-with scores floor(800 * 0.6) = 480; title word-starts-with scores 600.
    seedTrack({ id: "by-title", title: "The Nova Sound", artist: "Weight", albumId: "w-alb" });
    seedTrack({ id: "by-artist", title: "Unrelated", artist: "Novagreen", albumId: "w-alb" });

    const res = await search("nova");

    expect(res.tracks.map(t => t.id)).toEqual(["by-title", "by-artist"]);
  });

  it("drops a track the index matched only through its genre column", async () => {
    seedPair({ key: "title", albumName: "Genre Album", trackTitle: "Techno Dreams", artist: "T" });
    seedPair({ key: "genre", albumName: "Other Album", trackTitle: "Quiet Hours", artist: "Q", genre: "Techno" });

    const res = await search("techno");

    // The genre-only track is in the FTS pool - it just scores 0 and never reaches the caller.
    expect(db.raw.prepare(`SELECT COUNT(*) c FROM tracks_fts WHERE tracks_fts MATCH '"techno"*'`).get())
      .toEqual({ c: 2 });
    expect(res.tracks.map(t => t.id)).toEqual(["title-trk"]);
  });

  it("drops an album whose only match was a track title, not its own name or artist", async () => {
    seedAlbum({ id: "quiet-alb", name: "Quiet Hours", artist: "Quiet One" });
    seedTrack({ id: "loud-trk", title: "Thunder Roll", artist: "Quiet One", albumId: "quiet-alb" });

    const res = await search("thunder");

    expect(res.tracks.map(t => t.id)).toEqual(["loud-trk"]);
    expect(res.albums).toEqual([]);
  });

  it("breaks a score tie alphabetically for tracks and albums", async () => {
    seedAlbum({ id: "zeta-alb", name: "Zeta Mist", artist: "Zeta" });
    seedAlbum({ id: "alpha-alb", name: "Alpha Mist", artist: "Alpha" });
    seedTrack({ id: "z-trk", title: "Mist Zulu", artist: "Zeta", albumId: "zeta-alb" });
    seedTrack({ id: "a-trk", title: "Mist Alpha", artist: "Alpha", albumId: "alpha-alb" });

    const res = await search("mist");

    expect(res.tracks.map(t => t.title)).toEqual(["Mist Alpha", "Mist Zulu"]);
    expect(res.albums.map(a => a.name)).toEqual(["Alpha Mist", "Zeta Mist"]);
  });

  it("breaks a score tie between artists by album count, not alphabetically", async () => {
    seedAlbum({ id: "z1", name: "Zenith One", artist: "Zenith Zulu" });
    seedAlbum({ id: "z2", name: "Zenith Two", artist: "Zenith Zulu" });
    seedAlbum({ id: "a1", name: "Zenith Three", artist: "Zenith Alpha" });
    seedTrack({ id: "z1t", title: "Zenith Track A", artist: "Zenith Zulu", albumId: "z1" });
    seedTrack({ id: "z2t", title: "Zenith Track B", artist: "Zenith Zulu", albumId: "z2" });
    seedTrack({ id: "a1t", title: "Zenith Track C", artist: "Zenith Alpha", albumId: "a1" });

    const res = await search("zenith");

    expect(res.artists.map(a => [a.name, a.album_count])).toEqual([
      ["Zenith Zulu", 2],
      ["Zenith Alpha", 1],
    ]);
  });

  it("scores case-insensitively in both directions", async () => {
    seedPair({ key: "c", albumName: "Case Album", trackTitle: "love", artist: "C" });

    const res = await search("LOVE");

    // Exact tier, so it outranks a mere substring; the point is that it scored at all.
    expect(res.tracks.map(t => t.id)).toEqual(["c-trk"]);
  });

  it("scores on the title alone when the artist is null", async () => {
    seedAlbum({ id: "na-alb", name: "Null Artist Album" });
    seedTrack({ id: "na-trk", title: "Solace", artist: null, albumId: "na-alb" });

    const res = await search("solace");

    expect(res.tracks.map(t => t.id)).toEqual(["na-trk"]);
  });
});

describe("useSearch featured-artist collapsing", () => {
  it("drops a 'feat.' credit when the primary artist is also in the results", async () => {
    seedAlbum({ id: "f-alb", name: "Feat Album", artist: "Nomad" });
    seedTrack({ id: "f1", title: "Nomad Song", artist: "Nomad", albumId: "f-alb" });
    seedTrack({ id: "f2", title: "Nomad Duet", artist: "Nomad feat. Guest", albumId: "f-alb" });

    const res = await search("nomad");

    expect(res.artists.map(a => a.name)).toEqual(["Nomad"]);
  });

  it("keeps a 'feat.' credit when the primary artist is not in the results", async () => {
    seedAlbum({ id: "g-alb", name: "Guest Album", artist: "Wanderer feat. Guest" });
    seedTrack({ id: "g1", title: "Wanderer Song", artist: "Wanderer feat. Guest", albumId: "g-alb" });

    const res = await search("wanderer");

    expect(res.artists.map(a => a.name)).toEqual(["Wanderer feat. Guest"]);
  });

  it("collapses feat., ft. and featuring, ignoring case", async () => {
    seedAlbum({ id: "s-alb", name: "Sep Album", artist: "Pilot" });
    seedTrack({ id: "s0", title: "Pilot Base", artist: "Pilot", albumId: "s-alb" });
    seedTrack({ id: "s1", title: "Pilot One", artist: "Pilot feat. A", albumId: "s-alb" });
    seedTrack({ id: "s2", title: "Pilot Two", artist: "Pilot ft. B", albumId: "s-alb" });
    seedTrack({ id: "s3", title: "Pilot Three", artist: "Pilot FEATURING C", albumId: "s-alb" });

    const res = await search("pilot");

    expect(res.artists.map(a => a.name)).toEqual(["Pilot"]);
  });

  it("matches the primary artist case-insensitively when collapsing", async () => {
    seedAlbum({ id: "ci-alb", name: "Case Album", artist: "Vector" });
    seedTrack({ id: "ci0", title: "Vector Base", artist: "Vector", albumId: "ci-alb" });
    seedTrack({ id: "ci1", title: "Vector Duet", artist: "vector feat. Guest", albumId: "ci-alb" });

    const res = await search("vector");

    expect(res.artists.map(a => a.name)).toEqual(["Vector"]);
  });

  // FEAT_RE's `(.+?)` is non-greedy, so a chained credit's prefix is cut at the *first*
  // separator: "Rider feat. A feat. B" tests membership of "Rider", never of "Rider feat. A".
  // Both chained rows therefore survive when the bare primary is absent.
  it("cuts a chained credit's prefix at the first separator, so a chain does not collapse itself", async () => {
    seedAlbum({ id: "cc-alb", name: "Chain Album", artist: "Rider feat. A" });
    seedTrack({ id: "cc1", title: "Chain One", artist: "Rider feat. A", albumId: "cc-alb" });
    seedTrack({ id: "cc2", title: "Chain Two", artist: "Rider feat. A feat. B", albumId: "cc-alb" });

    const res = await search("rider");

    expect(res.artists.map(a => a.name).sort()).toEqual(["Rider feat. A", "Rider feat. A feat. B"]);
  });

  it("collapses the whole chain once the bare primary artist is present", async () => {
    seedAlbum({ id: "cd-alb", name: "Chain Album", artist: "Rider" });
    seedTrack({ id: "cd0", title: "Chain Base", artist: "Rider", albumId: "cd-alb" });
    seedTrack({ id: "cd1", title: "Chain One", artist: "Rider feat. A", albumId: "cd-alb" });
    seedTrack({ id: "cd2", title: "Chain Two", artist: "Rider feat. A feat. B", albumId: "cd-alb" });

    const res = await search("rider");

    expect(res.artists.map(a => a.name)).toEqual(["Rider"]);
  });
});

describe("useSearch query wiring", () => {
  it("does not query for an empty or whitespace-only search", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSearch("   ", SRV), { wrapper: wrapperFor(client) });

    await Promise.resolve();
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(db.selectCount).toBe(0);
  });

  it("does not query without a server id", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSearch("love", undefined), { wrapper: wrapperFor(client) });

    await Promise.resolve();
    expect(result.current.fetchStatus).toBe("idle");
    expect(db.selectCount).toBe(0);
  });

  it("does not query for an empty-string server id", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSearch("love", ""), { wrapper: wrapperFor(client) });

    await Promise.resolve();
    expect(result.current.fetchStatus).toBe("idle");
    expect(db.selectCount).toBe(0);
  });

  it("keys the cache on the trimmed query, so padded input reuses one fetch", async () => {
    seedPair({ key: "k", albumName: "Key Album", trackTitle: "Key Song", artist: "K" });
    const client = makeClient();

    await search("love", SRV, client);
    const after = db.selectCount;
    expect(after).toBe(3);

    await search("  love  ", SRV, client);

    expect(db.selectCount).toBe(after);
    expect(client.getQueryCache().find({ queryKey: QK.search(SRV, "love") })).toBeDefined();
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });

  it("serves a remount from cache inside the stale window instead of re-reading the library", async () => {
    seedPair({ key: "s", albumName: "Stale Album", trackTitle: "Stale Song", artist: "S" });
    const client = makeClient();

    await search("stale", SRV, client);
    expect(db.selectCount).toBe(3);

    const { unmount } = renderHook(() => useSearch("stale", SRV), { wrapper: wrapperFor(client) });
    unmount();
    await search("stale", SRV, client);

    expect(db.selectCount).toBe(3);
  });

  it("keeps the previous rows on screen while the next query runs", async () => {
    seedPair({ key: "one", albumName: "Ember Album", trackTitle: "Ember Song", artist: "E" });
    seedPair({ key: "two", albumName: "Ember Sequel", trackTitle: "Ember Reprise", artist: "E" });
    const client = makeClient();

    // Hold the second query open so the placeholder window is observable.
    const inner = db.select.bind(db);
    let release: (() => void) | null = null;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let gated = false;
    db.select = (async (sql: string, params?: unknown[]) => {
      if (gated) await gate;
      return inner(sql, params);
    }) as typeof db.select;

    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q, SRV), {
      wrapper: wrapperFor(client),
      initialProps: { q: "ember song" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.tracks.map(t => t.id)).toEqual(["one-trk"]);

    gated = true;
    rerender({ q: "ember reprise" });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data!.tracks.map(t => t.id)).toEqual(["one-trk"]);

    gated = false;
    release!();
    await waitFor(() => expect(result.current.data!.tracks.map(t => t.id)).toEqual(["two-trk"]));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  // The hook sets no `retry` of its own, so the count below is the three concurrent section
  // reads of a single attempt - it holds only because the test client sets `retry: false`.
  it("surfaces a failing read as an error", async () => {
    const failing = vi.fn(async () => {
      throw new Error("db gone");
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...db,
      select: failing,
    });
    const client = makeClient();

    const { result } = renderHook(() => useSearch("love", SRV), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(failing).toHaveBeenCalledTimes(3);
  });
});
