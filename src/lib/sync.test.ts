/**
 * Coverage for `src/lib/sync.ts` against the real migrated schema.
 *
 * The whole point of this file is the delete paths. `syncLibrary` reads complete whether or
 * not a prune runs, so an upsert-only sync looks healthy forever while diverging from the
 * server (see known-issues.md, "A sync that only upserts diverges from its source"). Every
 * prune, prune refusal and local-column carve-out below pins one clause of that entry.
 *
 * Wiring: `sync.ts`, `tagIssues.ts` and `tag-normalize.ts` all reach the DB through the same
 * `getDb()` specifier, so one mock covers all three and the tag scan / vocab rebuild run real
 * SQL against the real schema. Only the network boundary (`./navidrome`) and the keychain
 * (via the Tauri `invoke` mock) are faked.
 */
import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import type { NavidromeAlbum, NavidromePlaylist, NavidromeStarred, NavidromeTrack } from "./navidrome";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../db", () => ({ getDb: async () => holder.db }));

vi.mock("./navidrome", () => ({
  fetchAllAlbums: vi.fn(),
  fetchAlbumTracks: vi.fn(),
  fetchStarred2: vi.fn(),
  fetchPlaylists: vi.fn(),
  fetchPlaylistTracks: vi.fn(),
  fetchAndStoreOpenSubsonicExtensions: vi.fn(),
}));

import {
  fetchAllAlbums,
  fetchAlbumTracks,
  fetchStarred2,
  fetchPlaylists,
  fetchPlaylistTracks,
  fetchAndStoreOpenSubsonicExtensions,
} from "./navidrome";
import { purgeServerData, syncLibrary, syncAlbumTracks } from "./sync";
import { album, OTHER, server, SRV, track } from "../test/navidromeFixtures";

const mAllAlbums = vi.mocked(fetchAllAlbums);
const mAlbumTracks = vi.mocked(fetchAlbumTracks);
const mStarred = vi.mocked(fetchStarred2);
const mPlaylists = vi.mocked(fetchPlaylists);
const mPlaylistTracks = vi.mocked(fetchPlaylistTracks);
const mExtensions = vi.mocked(fetchAndStoreOpenSubsonicExtensions);

// `db-batch.ts`'s and `sync.ts`'s signatures only ask for the execute/select surface the
// plugin's Database provides, which FakeDatabase already implements.
function asDb(db: FakeDatabase): Database {
  return db as unknown as Database;
}

/** Point the album-list and per-album track mocks at one canned library. */
function serveLibrary(albums: NavidromeAlbum[], tracksByAlbumId: Record<string, NavidromeTrack[]>): void {
  mAllAlbums.mockResolvedValue(albums);
  mAlbumTracks.mockImplementation(async (_url, _user, _cred, albumId) => tracksByAlbumId[albumId] ?? []);
}

function db(): FakeDatabase {
  if (!holder.db) throw new Error("test db not initialized");
  return holder.db;
}

async function count(table: string, where = "", params: unknown[] = []): Promise<number> {
  const rows = await db().select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM ${table} ${where}`,
    params
  );
  return rows[0]?.c ?? 0;
}

async function ids(sql: string, params: unknown[] = []): Promise<string[]> {
  const rows = await db().select<{ id: string }[]>(sql, params);
  return rows.map((r) => r.id);
}

beforeEach(async () => {
  resetTauriMocks();
  vi.clearAllMocks();
  holder.db = await createMigratedTestDb();
  onInvoke("get_credential", () => JSON.stringify({ type: "apikey", apiKey: "k" }));
  mStarred.mockResolvedValue({} as NavidromeStarred);
  mPlaylists.mockResolvedValue([]);
  mPlaylistTracks.mockResolvedValue([]);
  mExtensions.mockResolvedValue(undefined as never);
  serveLibrary([], {});
});

// ---------------------------------------------------------------------------
// purgeServerData - the delete path the whole server_id ownership rule leans on
// ---------------------------------------------------------------------------

/** Seed one server's worth of rows across every table `purgeServerData` names. */
function seedServerRows(d: FakeDatabase, serverId: string): void {
  const al = `${serverId}:al-1`;
  const tr = `${serverId}:tr-1`;
  const pl = `${serverId}:pl-1`;
  d.raw.exec(`
    INSERT INTO albums (id, server_id, server_type, name, artist) VALUES ('${al}', '${serverId}', 'navidrome', 'A', 'Artist');
    INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES ('${tr}', '${serverId}', 'navidrome', 'T', '${al}');
    INSERT INTO artists (id, server_id, server_type, name) VALUES ('${serverId}-ar', '${serverId}', 'navidrome', 'Artist');
    INSERT INTO playlists (id, server_id, name) VALUES ('${pl}', '${serverId}', 'P');
    INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('${pl}', '${tr}', 0);
    INSERT INTO playlist_resume (playlist_id, last_track_id, track_position) VALUES ('${pl}', '${tr}', 3);
    INSERT INTO tracks_fts (id, title, artist, album, genre) VALUES ('${tr}', 'T', 'Artist', 'A', 'Rock');
    INSERT INTO track_tags (track_id, kind, raw_value, source) VALUES ('${tr}', 'genre', 'Rock', 'server');
    INSERT INTO loved_tracks (track_id) VALUES ('${tr}');
    INSERT INTO loved_albums (album_id) VALUES ('${al}');
    INSERT INTO tag_issues (track_id, issue_type) VALUES ('${tr}', 'missing_genre');
    INSERT INTO lyrics (track_id, plain, source, fetched_at) VALUES ('${tr}', 'la', 'lrclib', '2026-01-01');
    INSERT INTO waveform_cache (track_id, peaks_json, created_at) VALUES ('${tr}', '[]', 1);
    INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES ('${tr}', 'T', 'Artist', 1);
    INSERT INTO scrobble_history (track_id, timestamp) VALUES ('${tr}', 1);
    INSERT INTO album_covers (album_id, data_url, cached_at) VALUES ('${al}', 'data:x', 1);
    INSERT INTO album_identity (album_id) VALUES ('${al}');
    INSERT INTO album_user_genres (album_id, canonical_id, name) VALUES ('${al}', 'rock', 'Rock');
    INSERT INTO album_genre_exclusions (album_id, canonical_id) VALUES ('${al}', 'pop');
    INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES ('${al}', 'rock', 'direct', 'Rock');
    INSERT INTO album_unresolved_genres (album_id, raw_value, source) VALUES ('${al}', 'weird', 'server');
    INSERT INTO settings (key, value) VALUES ('server.opensub_extensions.${serverId}', '["x"]');
  `);
}

const OWNED_TABLES = [
  "albums", "tracks", "artists", "playlists", "playlist_tracks", "playlist_resume",
  "tracks_fts", "track_tags", "loved_tracks", "loved_albums", "tag_issues", "lyrics",
  "waveform_cache", "scrobble_queue", "scrobble_history", "album_covers", "album_identity",
  "album_user_genres", "album_genre_exclusions", "album_genres", "album_unresolved_genres",
];

describe("purgeServerData", () => {
  it("removes every server_id-owned row for the target server", async () => {
    seedServerRows(db(), SRV);
    await purgeServerData(asDb(db()), SRV);
    for (const table of OWNED_TABLES) {
      expect({ table, rows: await count(table) }).toEqual({ table, rows: 0 });
    }
  });

  it("leaves another server's rows completely intact", async () => {
    seedServerRows(db(), SRV);
    seedServerRows(db(), OTHER);
    const before = await Promise.all(OWNED_TABLES.map((t) => count(t)));
    await purgeServerData(asDb(db()), SRV);
    const after = await Promise.all(OWNED_TABLES.map((t) => count(t)));
    // Each table was seeded once per server, so exactly half must survive.
    expect(after).toEqual(before.map((n) => n / 2));
  });

  it("keeps the tables that are not server-owned", async () => {
    seedServerRows(db(), SRV);
    db().raw.exec(`
      INSERT INTO artist_identity (artist_name) VALUES ('Artist');
      INSERT INTO artist_aliases (alias_name, canonical_name) VALUES ('artist', 'Artist');
      INSERT INTO artist_covers (artist_name, data_url, cached_at) VALUES ('Artist', 'data:x', 1);
      INSERT INTO radio_signal_cache (cache_key, value, fetched_at) VALUES ('k', 'v', 1);
      INSERT INTO tag_mappings (raw_value, kind, canonical_id) VALUES ('rock', 'genre', 'rock');
      INSERT INTO user_tree_nodes (id, name, type, canonical_key) VALUES ('n', 'N', 'genre', 'n');
    `);
    await purgeServerData(asDb(db()), SRV);
    for (const table of ["artist_identity", "artist_aliases", "artist_covers", "radio_signal_cache", "tag_mappings", "user_tree_nodes"]) {
      expect({ table, rows: await count(table) }).toEqual({ table, rows: 1 });
    }
  });

  it("deletes only its own opensub_extensions settings key", async () => {
    seedServerRows(db(), SRV);
    seedServerRows(db(), OTHER);
    db().raw.exec("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    await purgeServerData(asDb(db()), SRV);
    const keys = await db().select<{ key: string }[]>("SELECT key FROM settings ORDER BY key");
    expect(keys.map((r) => r.key)).toEqual(["server.opensub_extensions.srv-b", "theme"]);
  });

  it("leaves no track-keyed orphans behind, so DELETE FROM tracks must stay last", async () => {
    // The track-keyed statements are subselects over `tracks`. If the tracks delete ever
    // moves above them the subselects match nothing and every dependent row survives
    // silently, which no total-row-count assertion would catch.
    seedServerRows(db(), SRV);
    await purgeServerData(asDb(db()), SRV);
    const trackKeyed: [string, string][] = [
      ["tracks_fts", "id"], ["track_tags", "track_id"], ["loved_tracks", "track_id"],
      ["playlist_tracks", "track_id"], ["tag_issues", "track_id"], ["lyrics", "track_id"],
      ["waveform_cache", "track_id"], ["scrobble_queue", "track_id"], ["scrobble_history", "track_id"],
    ];
    for (const [table, column] of trackKeyed) {
      expect({ table, rows: await count(table, `WHERE ${column} LIKE '${SRV}:%'`) }).toEqual({ table, rows: 0 });
    }
  });

  it("runs clean against a server with no rows at all", async () => {
    await expect(purgeServerData(asDb(db()), "never-synced")).resolves.toBeUndefined();
  });

  it("removes album-keyed rows for an album-only library with zero tracks", async () => {
    db().raw.exec(`
      INSERT INTO albums (id, server_id, server_type, name) VALUES ('${SRV}:al-1', '${SRV}', 'navidrome', 'A');
      INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES ('${SRV}:al-1', 'rock', 'direct', 'Rock');
    `);
    await purgeServerData(asDb(db()), SRV);
    expect(await count("albums")).toBe(0);
    expect(await count("album_genres")).toBe(0);
  });

  it("removes a purged server's playlist rows without touching another server's track", async () => {
    seedServerRows(db(), OTHER);
    db().raw.exec(`
      INSERT INTO playlists (id, server_id, name) VALUES ('${SRV}:pl-x', '${SRV}', 'X');
      INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('${SRV}:pl-x', '${OTHER}:tr-1', 0);
    `);
    await purgeServerData(asDb(db()), SRV);
    expect(await count("playlists")).toBe(1);
    expect(await count("playlist_tracks")).toBe(1); // only srv-b's own row remains
    expect(await count("tracks", "WHERE id = ?", [`${OTHER}:tr-1`])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// syncLibrary
// ---------------------------------------------------------------------------

describe("syncLibrary initial sync", () => {
  it("writes albums, tracks, artists and playlists on a first run", async () => {
    serveLibrary([album("al-1"), album("al-2", { artist: "Artist Two" })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      "al-2": [track("t3", "al-2")],
    });
    mPlaylists.mockResolvedValue([{ id: "pl-1", name: "Mix", songCount: 1 } as NavidromePlaylist]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1")]);

    const result = await syncLibrary(server());

    expect(await ids("SELECT id FROM albums ORDER BY id")).toEqual([`${SRV}:al-1`, `${SRV}:al-2`]);
    expect(await count("tracks")).toBe(3);
    expect(await count("tracks_fts")).toBe(3);
    const artists = await db().select<{ name: string; album_count: number }[]>(
      "SELECT name, album_count FROM artists ORDER BY name"
    );
    expect(artists).toEqual([
      { name: "Artist One", album_count: 1 },
      { name: "Artist Two", album_count: 1 },
    ]);
    expect(await count("playlists")).toBe(1);
    expect(await count("playlist_tracks")).toBe(1);
    expect(result).toMatchObject({ failedAlbums: 0, skippedAlbums: 0, prunedAlbums: 0, prunedTracks: 0 });
    expect(result.changed).toEqual({ albums: true, tracks: true, artists: true, loved: false, playlists: true });
  });

  it("writes a track_tags row only for tracks that carry a genre", async () => {
    serveLibrary([album("al-1")], {
      "al-1": [track("t1", "al-1", { genre: "Rock" }), track("t2", "al-1", { genre: "" })],
    });
    await syncLibrary(server());
    const tags = await db().select<{ track_id: string }[]>("SELECT track_id FROM track_tags");
    expect(tags.map((r) => r.track_id)).toEqual([`${SRV}:t1`]);
  });

  it("resolves release_type from releaseTypes first, then releaseType, then null", async () => {
    serveLibrary(
      [
        album("al-1", { releaseTypes: ["ep", "album"] }),
        album("al-2", { releaseTypes: [], releaseType: "album" }),
        album("al-3"),
      ],
      {}
    );
    await syncLibrary(server());
    const rows = await db().select<{ id: string; release_type: string | null }[]>(
      "SELECT id, release_type FROM albums ORDER BY id"
    );
    expect(rows.map((r) => r.release_type)).toEqual(["ep", "album", null]);
  });

  it("passes a null alt_url to the fetches as undefined, not null", async () => {
    serveLibrary([album("al-1")], { "al-1": [] });
    await syncLibrary(server());
    expect(mAllAlbums.mock.calls[0]?.[3]).toBeUndefined();
  });

  it("migrates a legacy credential stored without a type field", async () => {
    onInvoke("get_credential", () => JSON.stringify({ token: "tok", salt: "sal" }));
    serveLibrary([album("al-1")], { "al-1": [] });
    await syncLibrary(server());
    expect(mAllAlbums.mock.calls[0]?.[2]).toEqual({ type: "md5", token: "tok", salt: "sal" });
  });

  it("refuses to fetch anything when the stored credential is not valid JSON", async () => {
    onInvoke("get_credential", () => "{not json");
    await expect(syncLibrary(server())).rejects.toThrow(/Corrupt credentials/);
    expect(mAllAlbums).not.toHaveBeenCalled();
  });

  it("does not fail the sync when extension discovery rejects", async () => {
    mExtensions.mockRejectedValue(new Error("offline"));
    serveLibrary([album("al-1")], { "al-1": [] });
    await expect(syncLibrary(server())).resolves.toBeDefined();
  });
});

describe("syncLibrary idempotence", () => {
  it("writes nothing at all on a second sync with unchanged data", async () => {
    serveLibrary([album("al-1"), album("al-2")], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      "al-2": [track("t3", "al-2"), track("t4", "al-2")],
    });
    mPlaylists.mockResolvedValue([{ id: "pl-1", name: "Mix", songCount: 1 } as NavidromePlaylist]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1")]);
    mStarred.mockResolvedValue({ song: [{ id: "t1" }], album: [{ id: "al-1" }] });

    await syncLibrary(server());
    db().executeCount = 0;
    const second = await syncLibrary(server());

    // Zero executes also proves scanForIssues and rebuildTagVocabCache stayed out: both are
    // whole-table sweeps gated on albumsChanged || tracksChanged.
    expect(db().executeCount).toBe(0);
    expect(second.changed).toEqual({ albums: false, tracks: false, artists: false, loved: false, playlists: false });
  });

  it("treats a SQLite integer year and an API string year as the same value", async () => {
    serveLibrary([album("al-1", { year: 2020 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    serveLibrary([album("al-1", { year: "2020" as unknown as number })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    db().executeCount = 0;
    expect((await syncLibrary(server())).changed.albums).toBe(false);
    expect(db().executeCount).toBe(0);
  });

  it("treats a stored null artist and an empty-string artist as the same value", async () => {
    serveLibrary([album("al-1", { artist: "" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    db().raw.exec(`UPDATE albums SET artist = NULL WHERE id = '${SRV}:al-1'`);
    db().executeCount = 0;
    expect((await syncLibrary(server())).changed.albums).toBe(false);
  });

  it("rewrites the album row when a compared column really moved", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    serveLibrary([album("al-1", { name: "Renamed" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const second = await syncLibrary(server());
    expect(second.changed.albums).toBe(true);
    const rows = await db().select<{ name: string }[]>("SELECT name FROM albums");
    expect(rows[0]?.name).toBe("Renamed");
  });

  it("rebuilds the FTS row for a renamed album even when no track was fetched", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    serveLibrary([album("al-1", { name: "Renamed" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mAlbumTracks.mockClear();
    await syncLibrary(server());
    // The skip heuristic held (no track fetch), but the FTS row carries the album name.
    expect(mAlbumTracks).not.toHaveBeenCalled();
    const fts = await db().select<{ album: string }[]>("SELECT album FROM tracks_fts LIMIT 1");
    expect(fts[0]?.album).toBe("Renamed");
  });

  it("does not rebuild the artists table when only a non-artist column changed", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    serveLibrary([album("al-1", { name: "Renamed" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const second = await syncLibrary(server());
    expect(second.changed.artists).toBe(false);
  });
});

describe("syncLibrary album prune", () => {
  async function seedTwoAlbums(): Promise<void> {
    serveLibrary([album("al-1"), album("al-2")], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      "al-2": [track("t3", "al-2"), track("t4", "al-2")],
    });
    await syncLibrary(server());
  }

  it("deletes an album the server no longer lists, with its tracks and derived rows", async () => {
    await seedTwoAlbums();
    db().raw.exec(`
      INSERT INTO loved_albums (album_id) VALUES ('${SRV}:al-2');
      INSERT INTO loved_tracks (track_id) VALUES ('${SRV}:t3');
      INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES ('${SRV}:al-2', 'rock', 'direct', 'Rock');
      INSERT INTO album_unresolved_genres (album_id, raw_value, source) VALUES ('${SRV}:al-2', 'weird', 'server');
      INSERT INTO lyrics (track_id, plain, source, fetched_at) VALUES ('${SRV}:t3', 'la', 'lrclib', '2026-01-01');
      INSERT INTO waveform_cache (track_id, peaks_json, created_at) VALUES ('${SRV}:t3', '[]', 1);
    `);

    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const result = await syncLibrary(server());

    expect(result.prunedAlbums).toBe(1);
    expect(await ids("SELECT id FROM albums")).toEqual([`${SRV}:al-1`]);
    expect(await count("tracks", "WHERE album_id = ?", [`${SRV}:al-2`])).toBe(0);
    expect(await count("tracks_fts", "WHERE id LIKE '%t3'")).toBe(0);
    const albumKeyed: [string, string][] = [
      ["loved_albums", "album_id"], ["album_genres", "album_id"], ["album_unresolved_genres", "album_id"],
    ];
    for (const [table, column] of albumKeyed) {
      expect({ table, rows: await count(table, `WHERE ${column} = '${SRV}:al-2'`) }).toEqual({ table, rows: 0 });
    }
    for (const table of ["loved_tracks", "lyrics", "waveform_cache"]) {
      expect({ table, rows: await count(table, `WHERE track_id = '${SRV}:t3'`) }).toEqual({ table, rows: 0 });
    }
    // Losing albums can drop an artist or move an album_count, so the derived table is dirty.
    expect(result.changed).toMatchObject({ albums: true, tracks: true, artists: true });
  });

  it("keeps user-authored rows for a pruned album", async () => {
    await seedTwoAlbums();
    db().raw.exec(`
      INSERT INTO album_identity (album_id, mb_release_group_id) VALUES ('${SRV}:al-2', 'mbid');
      INSERT INTO album_user_genres (album_id, canonical_id, name) VALUES ('${SRV}:al-2', 'rock', 'Rock');
      INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES ('${SRV}:t3', 'T', 'A', 1);
      INSERT INTO scrobble_history (track_id, timestamp) VALUES ('${SRV}:t3', 1);
    `);
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    for (const table of ["album_identity", "album_user_genres", "scrobble_queue", "scrobble_history"]) {
      expect({ table, rows: await count(table) }).toEqual({ table, rows: 1 });
    }
  });

  it("refuses to prune when the server returns an empty album list", async () => {
    await seedTwoAlbums();
    serveLibrary([], {});
    const result = await syncLibrary(server());
    expect(result.prunedAlbums).toBe(0);
    expect(await count("albums")).toBe(2);
    expect(await count("tracks")).toBe(4);
    expect(result.changed.albums).toBe(false);
  });

  it("never reaches the prune when the album list fetch threw", async () => {
    await seedTwoAlbums();
    // `fetchAllAlbums` throws on any failed page rather than returning a short list, so a
    // partial list can never be handed to the prune. The prune's safety depends on that.
    mAllAlbums.mockRejectedValue(new Error("getAlbumList2 returned 500"));
    db().executeCount = 0;
    await expect(syncLibrary(server())).rejects.toThrow(/500/);
    expect(db().executeCount).toBe(0);
    expect(await count("albums")).toBe(2);
  });

  it("never treats another server's albums as stale", async () => {
    await seedTwoAlbums();
    db().raw.exec(
      `INSERT INTO albums (id, server_id, server_type, name) VALUES ('${OTHER}:al-9', '${OTHER}', 'navidrome', 'Other')`
    );
    serveLibrary([album("al-1"), album("al-2")], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      "al-2": [track("t3", "al-2"), track("t4", "al-2")],
    });
    const result = await syncLibrary(server());
    expect(result.prunedAlbums).toBe(0);
    expect(await count("albums", "WHERE server_id = ?", [OTHER])).toBe(1);
  });

  it("scopes the artists rebuild to its own server", async () => {
    db().raw.exec(
      `INSERT INTO artists (id, server_id, server_type, name, album_count) VALUES ('x', '${OTHER}', 'navidrome', 'Other Artist', 4)`
    );
    serveLibrary([album("al-1")], { "al-1": [] });
    await syncLibrary(server());
    expect(await count("artists", "WHERE server_id = ?", [OTHER])).toBe(1);
  });

  it("excludes albums with no artist from the derived artists table", async () => {
    serveLibrary([album("al-1", { artist: "" }), album("al-2", { artist: "Real" })], {});
    await syncLibrary(server());
    const rows = await db().select<{ name: string }[]>("SELECT name FROM artists");
    expect(rows.map((r) => r.name)).toEqual(["Real"]);
  });
});

describe("syncLibrary per-album track prune", () => {
  async function seedAlbumWithTracks(trackIds: string[]): Promise<void> {
    serveLibrary([album("al-1", { songCount: trackIds.length })], {
      "al-1": trackIds.map((id) => track(id, "al-1")),
    });
    await syncLibrary(server());
  }

  it("removes tracks the album no longer contains, with their derived rows", async () => {
    await seedAlbumWithTracks(["t1", "t2", "t3"]);
    db().raw.exec(`INSERT INTO lyrics (track_id, plain, source, fetched_at) VALUES ('${SRV}:t3', 'la', 'lrclib', '2026-01-01')`);

    serveLibrary([album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    const result = await syncLibrary(server());

    expect(result.prunedTracks).toBe(1);
    expect(await ids("SELECT id FROM tracks ORDER BY id")).toEqual([`${SRV}:t1`, `${SRV}:t2`]);
    expect(await count("lyrics")).toBe(0);
    expect(await count("track_tags", "WHERE track_id = ?", [`${SRV}:t3`])).toBe(0);
  });

  it("prunes nothing when the album fetch came back empty", async () => {
    await seedAlbumWithTracks(["t1", "t2", "t3"]);
    // An album that returned no tracks is far more likely a server hiccup than a genuinely
    // empty album, and `NOT IN ()` cannot be expressed anyway.
    serveLibrary([album("al-1", { songCount: 0, created: "2026-02-02T00:00:00Z" })], { "al-1": [] });
    const result = await syncLibrary(server());
    expect(result.prunedTracks).toBe(0);
    expect(await count("tracks")).toBe(3);
  });

  // The bound-parameter ceiling either side of `SQLITE_MAX_VARIABLES - 1` is pinned in
  // `sync.pruneCeiling.test.ts`, which stubs the constant small - asserting that boundary
  // against the real 32000 costs ~5s per case for nothing the assertion reads.

  it("only queries for stale tracks on an album that already had rows", async () => {
    const seen: string[] = [];
    const realSelect = db().select.bind(db());
    db().select = (async (sql: string, params?: unknown[]) => {
      seen.push(sql);
      return realSelect(sql, params);
    }) as FakeDatabase["select"];

    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    // First sync: nothing to prune, so the round trip would be wasted once per album.
    expect(seen.filter((s) => /NOT IN/.test(s))).toHaveLength(0);

    seen.length = 0;
    serveLibrary([album("al-1", { created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    await syncLibrary(server());
    expect(seen.filter((s) => /NOT IN/.test(s))).toHaveLength(1);
  });
});

describe("syncLibrary track-skip heuristic", () => {
  it("skips an album whose created stamp and track count both match", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server());
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(second.skippedAlbums).toBe(1);
  });

  it("re-fetches when the stored track count is one short of songCount", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    db().raw.exec(`DELETE FROM tracks WHERE id = '${SRV}:t2'`);
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server());
    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
    expect(second.skippedAlbums).toBe(0);
  });

  it("does not wedge into re-fetching forever after a server-side track deletion", async () => {
    // The bug this pins: without the per-album prune the stored count stays permanently above
    // songCount, the skip test can never match again, and the album is re-fetched on every
    // sync forever, dragging the FTS rebuild and the tag scans with it.
    serveLibrary([album("al-1", { songCount: 3 })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1"), track("t3", "al-1")],
    });
    await syncLibrary(server());

    const shrunk = album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" });
    serveLibrary([shrunk], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const second = await syncLibrary(server());
    expect(second.prunedTracks).toBe(1);

    mAlbumTracks.mockClear();
    const third = await syncLibrary(server());
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(third.skippedAlbums).toBe(1);
  });

  it("never skips an album whose stored created stamp is null", async () => {
    serveLibrary([album("al-1", { created: undefined })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    mAlbumTracks.mockClear();
    await syncLibrary(server());
    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
  });

  it("skips on the created stamp alone when the server omits songCount", async () => {
    serveLibrary([album("al-1", { songCount: undefined })], { "al-1": [track("t1", "al-1")] });
    await syncLibrary(server());
    db().raw.exec(`DELETE FROM tracks WHERE id = '${SRV}:t1'`);
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server());
    // No songCount means no count comparison is possible, so a track deletion goes unnoticed
    // until the album's `created` stamp moves.
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(second.skippedAlbums).toBe(1);
  });
});

describe("syncLibrary album track failures", () => {
  function libraryOf(n: number): NavidromeAlbum[] {
    return Array.from({ length: n }, (_, i) => album(`al-${i}`, { songCount: 1 }));
  }

  it("gives up on the album pass after five consecutive failures", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(10));
    mAlbumTracks.mockRejectedValue(new Error("timeout"));
    const result = await syncLibrary(server());
    expect(mAlbumTracks).toHaveBeenCalledTimes(5);
    expect(result.failedAlbums).toBe(5);
    expect(result.albumTracksIncomplete).toBe(true);
  });

  it("keeps going after four consecutive failures", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(10));
    let call = 0;
    mAlbumTracks.mockImplementation(async () => {
      call++;
      if (call <= 4) throw new Error("timeout");
      return [track(`t${call}`, `al-${call}`)];
    });
    const result = await syncLibrary(server());
    expect(mAlbumTracks).toHaveBeenCalledTimes(10);
    expect(result.failedAlbums).toBe(4);
    expect(result.albumTracksIncomplete).toBe(false);
  });

  it("resets the failure run on any success, so scattered failures never trip the limit", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(8));
    const outcomes = [false, false, true, false, false, false, false, true];
    let call = 0;
    mAlbumTracks.mockImplementation(async () => {
      const ok = outcomes[call++];
      if (!ok) throw new Error("timeout");
      return [track(`t${call}`, `al-${call}`)];
    });
    const result = await syncLibrary(server());
    // Six failures total, never five in a row: a naive `failedAlbums >= 5` breaks here.
    expect(result.failedAlbums).toBe(6);
    expect(result.albumTracksIncomplete).toBe(false);
    expect(mAlbumTracks).toHaveBeenCalledTimes(8);
  });

  it("leaves an album's existing tracks alone when its fetch fails", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    serveLibrary([album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" })], {});
    mAlbumTracks.mockRejectedValue(new Error("timeout"));
    const second = await syncLibrary(server());
    expect(second.failedAlbums).toBe(1);
    expect(await count("tracks")).toBe(2);
  });

  it("reports progress against the number of albums that actually need tracks", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(3));
    mAlbumTracks.mockResolvedValue([]);
    const progress: { done: number; total: number }[] = [];
    await syncLibrary(server(), (p) => progress.push(p));
    expect(progress[0]).toEqual({ done: 0, total: 3 });
    expect(progress[1]).toEqual({ done: 1, total: 3 });
  });

  it("runs without a progress callback", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(2));
    mAlbumTracks.mockResolvedValue([]);
    await expect(syncLibrary(server())).resolves.toBeDefined();
  });
});

describe("syncLibrary loved stage", () => {
  it("reaches equality again on a starred id with no local track row", async () => {
    // The write inserts every starred id the server reported; a read scoped by a join to
    // tracks could never see the orphan, so the counts never matched and both loved tables
    // were rewritten on every 5-minute tick forever.
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }, { id: "gone" }], album: [] });
    await syncLibrary(server());
    expect(await count("loved_tracks")).toBe(2);

    const second = await syncLibrary(server());
    expect(second.changed.loved).toBe(false);
    db().executeCount = 0;
    const third = await syncLibrary(server());
    expect(third.changed.loved).toBe(false);
    expect(db().executeCount).toBe(0);
  });

  it("rewrites loved state when the server's starred set really moved", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }] });
    await syncLibrary(server());
    mStarred.mockResolvedValue({ song: [{ id: "t2" }] });
    const second = await syncLibrary(server());
    expect(second.changed.loved).toBe(true);
    expect(await ids("SELECT track_id AS id FROM loved_tracks")).toEqual([`${SRV}:t2`]);
  });

  it("detects an equal-sized but disjoint starred set", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mStarred.mockResolvedValue({ album: [{ id: "al-1" }] });
    await syncLibrary(server());
    mStarred.mockResolvedValue({ album: [{ id: "al-9" }] });
    const second = await syncLibrary(server());
    expect(second.changed.loved).toBe(true);
    expect(await ids("SELECT album_id AS id FROM loved_albums")).toEqual([`${SRV}:al-9`]);
  });

  it("does not delete another server's loved rows", async () => {
    db().raw.exec(`INSERT INTO loved_tracks (track_id) VALUES ('${OTHER}:t9')`);
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }] });
    await syncLibrary(server());
    expect(await count("loved_tracks", "WHERE track_id = ?", [`${OTHER}:t9`])).toBe(1);
  });

  it("does not delete a sibling server whose id differs only at a LIKE wildcard", async () => {
    // `srv_a` and `srv-a` differ only where the underscore sits, and `_` is a single-character
    // wildcard, so an unescaped `<id>:%` prefix matches both. The loved DELETEs are scoped by
    // exactly that prefix, so the sibling's user-authored rows were the thing destroyed.
    const WILD = "srv_a";
    db().raw.exec(`INSERT INTO loved_tracks (track_id) VALUES ('srv-a:t9')`);
    db().raw.exec(`INSERT INTO loved_albums (album_id) VALUES ('srv-a:al-9')`);
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }], album: [] });

    await syncLibrary(server(WILD));

    expect(await count("loved_tracks", "WHERE track_id = ?", ["srv-a:t9"])).toBe(1);
    expect(await count("loved_albums", "WHERE album_id = ?", ["srv-a:al-9"])).toBe(1);
    // Positive control: the wildcard server's own row was still written, so the assertions
    // above are not passing against a sync that did nothing.
    expect(await count("loved_tracks", "WHERE track_id = ?", [`${WILD}:t1`])).toBe(1);
  });

  it("keeps stored loved state and reports the stage when the starred fetch fails", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }] });
    await syncLibrary(server());

    mStarred.mockRejectedValue(new Error("offline"));
    const second = await syncLibrary(server());
    expect(second.skippedStages).toContain("loved");
    expect(second.changed.loved).toBe(false);
    expect(await count("loved_tracks")).toBe(1);
  });
});

describe("syncLibrary playlist stage", () => {
  const pl = (id: string, overrides: Partial<NavidromePlaylist> = {}): NavidromePlaylist => ({
    id,
    name: `Playlist ${id}`,
    songCount: 1,
    ...overrides,
  });

  async function seedPlaylists(): Promise<void> {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mPlaylists.mockResolvedValue([pl("pl-1"), pl("pl-2")]);
    mPlaylistTracks.mockImplementation(async (_u, _n, _c, id) =>
      id === "pl-1" ? [track("t1", "al-1")] : [track("t2", "al-1")]
    );
    await syncLibrary(server());
  }

  it("keeps Canon-owned playlist columns across a refresh that changed the name", async () => {
    // The server payload knows nothing about is_smart / rules_json / custom_cover_data, so a
    // DELETE-then-INSERT silently turned a smart playlist into an ordinary one.
    await seedPlaylists();
    db().raw.exec(
      `UPDATE playlists SET is_smart = 1, rules_json = '{"r":1}', custom_cover_data = 'data:png' WHERE id = '${SRV}:pl-1'`
    );
    mPlaylists.mockResolvedValue([pl("pl-1", { name: "Renamed" }), pl("pl-2")]);
    const second = await syncLibrary(server());

    expect(second.changed.playlists).toBe(true);
    const rows = await db().select<{ name: string; is_smart: number; rules_json: string | null; custom_cover_data: string | null }[]>(
      "SELECT name, is_smart, rules_json, custom_cover_data FROM playlists WHERE id = ?",
      [`${SRV}:pl-1`]
    );
    expect(rows[0]).toEqual({ name: "Renamed", is_smart: 1, rules_json: '{"r":1}', custom_cover_data: "data:png" });
  });

  it("rewrites track rows only for the playlist whose ordered list moved", async () => {
    await seedPlaylists();
    const deletes: string[] = [];
    const realExecute = db().execute.bind(db());
    db().execute = (async (sql: string, params?: unknown[]) => {
      if (/DELETE FROM playlist_tracks WHERE playlist_id = \?/.test(sql)) deletes.push(String(params?.[0]));
      return realExecute(sql, params);
    }) as FakeDatabase["execute"];

    mPlaylistTracks.mockImplementation(async (_u, _n, _c, id) =>
      id === "pl-1" ? [track("t1", "al-1")] : [track("t2", "al-1"), track("t1", "al-1")]
    );
    mPlaylists.mockResolvedValue([pl("pl-1"), pl("pl-2", { songCount: 2 })]);
    await syncLibrary(server());

    expect(deletes).toEqual([`${SRV}:pl-2`]);
  });

  it("writes contiguous positions after a mid-list removal", async () => {
    serveLibrary([album("al-1")], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1"), track("t3", "al-1")],
    });
    mPlaylists.mockResolvedValue([pl("pl-1", { songCount: 3 })]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1"), track("t2", "al-1"), track("t3", "al-1")]);
    await syncLibrary(server());

    mPlaylists.mockResolvedValue([pl("pl-1", { songCount: 2 })]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1"), track("t3", "al-1")]);
    await syncLibrary(server());

    // `position` doubles as the remote Subsonic index, so a hole makes the next removal
    // delete the wrong remote track.
    const rows = await db().select<{ track_id: string; position: number }[]>(
      "SELECT track_id, position FROM playlist_tracks ORDER BY position"
    );
    expect(rows).toEqual([
      { track_id: `${SRV}:t1`, position: 0 },
      { track_id: `${SRV}:t3`, position: 1 },
    ]);
  });

  it("prunes a playlist the server no longer lists, with its tracks and resume row", async () => {
    await seedPlaylists();
    db().raw.exec(
      `INSERT INTO playlist_resume (playlist_id, last_track_id, track_position) VALUES ('${SRV}:pl-2', '${SRV}:t2', 1)`
    );
    mPlaylists.mockResolvedValue([pl("pl-1")]);
    await syncLibrary(server());
    expect(await ids("SELECT id FROM playlists")).toEqual([`${SRV}:pl-1`]);
    expect(await count("playlist_tracks", "WHERE playlist_id = ?", [`${SRV}:pl-2`])).toBe(0);
    expect(await count("playlist_resume")).toBe(0);
  });

  it("keeps stored playlists and reports the stage when the listing fetch fails", async () => {
    await seedPlaylists();
    mPlaylists.mockRejectedValue(new Error("offline"));
    const second = await syncLibrary(server());
    expect(second.skippedStages).toContain("playlists");
    expect(second.changed.playlists).toBe(false);
    expect(await count("playlists")).toBe(2);
    expect(await count("playlist_tracks")).toBe(2);
  });

  it("blocks every playlist write when one playlist's track fetch fails", async () => {
    await seedPlaylists();
    mPlaylists.mockResolvedValue([pl("pl-1", { name: "Renamed" }), pl("pl-2")]);
    mPlaylistTracks.mockImplementation(async (_u, _n, _c, id) => {
      if (id === "pl-2") throw new Error("offline");
      return [track("t1", "al-1")];
    });
    const second = await syncLibrary(server());

    // An incomplete picture must not reach the prune: pl-2 would be erased outright.
    expect(second.failedPlaylists).toBe(1);
    expect(second.changed.playlists).toBe(false);
    const rows = await db().select<{ name: string }[]>("SELECT name FROM playlists ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(["Playlist pl-1", "Playlist pl-2"]);
  });

  it("does not see another server's playlists", async () => {
    db().raw.exec(`
      INSERT INTO playlists (id, server_id, name) VALUES ('${OTHER}:pl-9', '${OTHER}', 'Other');
      INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('${OTHER}:pl-9', '${OTHER}:t9', 0);
    `);
    await seedPlaylists();
    expect(await count("playlists", "WHERE server_id = ?", [OTHER])).toBe(1);
    expect(await count("playlist_tracks", "WHERE playlist_id = ?", [`${OTHER}:pl-9`])).toBe(1);
  });

  it("reports both skipped stages when loved and playlists both fail", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1")] });
    mStarred.mockRejectedValue(new Error("offline"));
    mPlaylists.mockRejectedValue(new Error("offline"));
    const result = await syncLibrary(server());
    expect(result.skippedStages).toEqual(["loved", "playlists"]);
  });
});

describe("syncAlbumTracks", () => {
  it("strips the server prefix from the album id, including ids containing a colon", async () => {
    mAlbumTracks.mockResolvedValue([track("t1", "al:1")]);
    await syncAlbumTracks(server(), { type: "apikey", apiKey: "k" }, `${SRV}:al:1`);
    expect(mAlbumTracks.mock.calls[0]?.[3]).toBe("al:1");
  });

  it("writes the fetched tracks without pruning what the album no longer has", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server());
    mAlbumTracks.mockResolvedValue([track("t1", "al-1")]);
    await syncAlbumTracks(server(), { type: "apikey", apiKey: "k" }, `${SRV}:al-1`);
    // The manual per-album refresh only upserts, so a removed track survives until the next
    // full syncLibrary run prunes it.
    expect(await count("tracks")).toBe(2);
  });

  it("stores replay gain sub-fields individually and defaults play_count to zero", async () => {
    mAlbumTracks.mockResolvedValue([
      track("t1", "al-1", { replayGain: { trackGain: -3 } }),
      track("t2", "al-1", {}),
    ]);
    await syncAlbumTracks(server(), { type: "apikey", apiKey: "k" }, `${SRV}:al-1`);
    const rows = await db().select<{
      id: string; replay_gain_track_gain: number | null; replay_gain_album_gain: number | null; play_count: number;
    }[]>(
      "SELECT id, replay_gain_track_gain, replay_gain_album_gain, play_count FROM tracks ORDER BY id"
    );
    expect(rows).toEqual([
      { id: `${SRV}:t1`, replay_gain_track_gain: -3, replay_gain_album_gain: null, play_count: 0 },
      { id: `${SRV}:t2`, replay_gain_track_gain: null, replay_gain_album_gain: null, play_count: 0 },
    ]);
  });
});
