/**
 * Coverage for `src/lib/sync.ts` against the real migrated schema.
 *
 * The whole point of this file is the delete paths. `syncLibrary` reads complete whether or
 * not a prune runs, so an upsert-only sync looks healthy forever while diverging from the
 * server (see known-issues.md, "A sync that only upserts diverges from its source"). Every
 * prune, prune refusal and local-column carve-out below pins one clause of that entry.
 *
 * Wiring: `sync.ts`, `tagIssues.ts` and `tagNormalize.ts` all reach the DB through the same
 * `getDb()` specifier, so one mock covers all three and the tag scan / vocab rebuild run real
 * SQL against the real schema. Only the network boundary (`./navidrome`) and the keychain
 * (via the Tauri `invoke` mock) are faked.
 */
import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { onInvoke, resetTauriMocks } from "../../test/mocks/tauri";
import { remappedTrackIdTables } from "../../db/trackIdTables";
import { invokeCount } from "../../test/perf";
import type { NavidromeAlbum, NavidromeStarred, NavidromeTrack } from "../../clients/navidrome";
import type { NavidromePlaylist } from "../../clients/navidromePlaylists";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../../db", () => ({ getDb: async () => holder.db }));

vi.mock("../../clients/navidrome", () => ({
  fetchAllAlbums: vi.fn(),
  fetchAlbumTracks: vi.fn(),
  fetchStarred2: vi.fn(),
  fetchAndStoreOpenSubsonicExtensions: vi.fn(),
  fetchScanStatus: vi.fn(),
  songExists: vi.fn(),
}));
vi.mock("../../clients/navidromePlaylists", () => ({
  fetchPlaylists: vi.fn(),
  fetchPlaylistTracks: vi.fn(),
}));

import { fetchAllAlbums, fetchAlbumTracks, fetchStarred2, fetchAndStoreOpenSubsonicExtensions, fetchScanStatus, songExists } from "../../clients/navidrome";
import { fetchPlaylists, fetchPlaylistTracks } from "../../clients/navidromePlaylists";
import { syncLibrary } from "./sync";
import { clearSyncWatermark } from "./syncWatermark";
import { purgeServerData, purgeStrandedServers } from "./syncPrune";
import { repairAlbumTrackIds, syncAlbumTracks } from "./syncTracks";
import type { SyncProgress } from "./sync";
import { album, CRED, OTHER, server, SRV, track } from "../../test/navidromeFixtures";
import { TransportStalledError } from "../../lib/transportHealth";

const mAllAlbums = vi.mocked(fetchAllAlbums);
const mAlbumTracks = vi.mocked(fetchAlbumTracks);
const mStarred = vi.mocked(fetchStarred2);
const mPlaylists = vi.mocked(fetchPlaylists);
const mPlaylistTracks = vi.mocked(fetchPlaylistTracks);
const mExtensions = vi.mocked(fetchAndStoreOpenSubsonicExtensions);
const mScanStatus = vi.mocked(fetchScanStatus);
const mSongExists = vi.mocked(songExists);

// `dbBatch.ts`'s and `sync.ts`'s signatures only ask for the execute/select surface the
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
  mStarred.mockResolvedValue({} as NavidromeStarred);
  mPlaylists.mockResolvedValue([]);
  mPlaylistTracks.mockResolvedValue([]);
  mExtensions.mockResolvedValue(undefined as never);
  // Most tests are about what the sync writes, not about how it decides to skip: an
  // unreadable scan status plus ids that still resolve is the "nothing to see here" setup.
  mScanStatus.mockRejectedValue(new Error("not an admin"));
  mSongExists.mockResolvedValue(true);
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
    const tables = ["artist_identity", "artist_aliases", "artist_covers", "radio_signal_cache", "tag_mappings", "user_tree_nodes"];
    const before = await Promise.all(tables.map(async (table) => ({ table, rows: await count(table) })));
    expect(before.every((entry) => entry.rows > 0)).toBe(true);
    await purgeServerData(asDb(db()), SRV);
    const after = await Promise.all(tables.map(async (table) => ({ table, rows: await count(table) })));
    expect(after).toEqual(before);
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
describe("purgeStrandedServers", () => {
  it("takes every row of a server the servers table no longer lists", async () => {
    seedServerRows(db(), SRV);
    db().raw.exec(`INSERT INTO servers (id, type, url, display_name, username) VALUES ('${OTHER}', 'navidrome', 'http://b', 'B', 'u')`);
    seedServerRows(db(), OTHER);
    const stranded = await purgeStrandedServers(asDb(db()));
    expect(stranded).toEqual([SRV]);
    for (const table of OWNED_TABLES) {
      expect({ table, rows: await count(table) }).toEqual({ table, rows: 1 });
    }
  });

  it("finds a server stranded in tracks alone, after its albums already went", async () => {
    // The shape the bug shipped as: albums, artists and playlists gone, the track rows and
    // everything keyed to them left behind with no servers row to reach them from.
    seedServerRows(db(), SRV);
    db().raw.exec(`DELETE FROM albums; DELETE FROM artists; DELETE FROM playlists;`);
    await purgeStrandedServers(asDb(db()));
    expect(await count("tracks")).toBe(0);
    expect(await count("loved_tracks")).toBe(0);
    expect(await count("scrobble_queue")).toBe(0);
  });

  it("keeps every row while the server is still registered", async () => {
    db().raw.exec(`INSERT INTO servers (id, type, url, display_name, username) VALUES ('${SRV}', 'navidrome', 'http://a', 'A', 'u')`);
    seedServerRows(db(), SRV);
    const before = await Promise.all(OWNED_TABLES.map((t) => count(t)));
    expect(await purgeStrandedServers(asDb(db()))).toEqual([]);
    expect(await Promise.all(OWNED_TABLES.map((t) => count(t)))).toEqual(before);
  });

  it("writes nothing and reads once when there is nothing stranded", async () => {
    db().raw.exec(`INSERT INTO servers (id, type, url, display_name, username) VALUES ('${SRV}', 'navidrome', 'http://a', 'A', 'u')`);
    seedServerRows(db(), SRV);
    db().executeCount = 0;
    db().selectCount = 0;
    await purgeStrandedServers(asDb(db()));
    expect(db().executeCount).toBe(0);
    expect(db().selectCount).toBe(1);
  });

  it("runs clean on an empty database", async () => {
    await expect(purgeStrandedServers(asDb(db()))).resolves.toEqual([]);
  });

  it("purges a library left behind when no server is registered at all", async () => {
    seedServerRows(db(), SRV);
    expect(await purgeStrandedServers(asDb(db()))).toEqual([SRV]);
    expect(await count("tracks")).toBe(0);
  });

  it("takes both of two stranded servers", async () => {
    seedServerRows(db(), SRV);
    seedServerRows(db(), OTHER);
    expect((await purgeStrandedServers(asDb(db()))).sort()).toEqual([SRV, OTHER].sort());
    expect(await count("albums")).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("syncLibrary initial sync", () => {
  it("writes albums, tracks, artists and playlists on a first run", async () => {
    serveLibrary([album("al-1"), album("al-2", { artist: "Artist Two" })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      "al-2": [track("t3", "al-2")],
    });
    mPlaylists.mockResolvedValue([{ id: "pl-1", name: "Mix", songCount: 1 } as NavidromePlaylist]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1")]);

    const result = await syncLibrary(server(), CRED);

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
    await syncLibrary(server(), CRED);
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
    await syncLibrary(server(), CRED);
    const rows = await db().select<{ id: string; release_type: string | null }[]>(
      "SELECT id, release_type FROM albums ORDER BY id"
    );
    expect(rows.map((r) => r.release_type)).toEqual(["ep", "album", null]);
  });

  it("passes a null alt_url to the fetches as undefined, not null", async () => {
    serveLibrary([album("al-1")], { "al-1": [] });
    await syncLibrary(server(), CRED);
    expect(mAllAlbums.mock.calls[0]?.[3]).toBeUndefined();
  });

  it("uses the credential it was handed rather than reading one", async () => {
    serveLibrary([album("al-1")], { "al-1": [] });
    await syncLibrary(server(), { type: "md5", token: "tok", salt: "sal" });
    expect(mAllAlbums.mock.calls[0]?.[2]).toEqual({ type: "md5", token: "tok", salt: "sal" });
    expect(invokeCount("get_credential")).toBe(0);
  });

  it("does not fail the sync when extension discovery rejects", async () => {
    mExtensions.mockRejectedValue(new Error("offline"));
    serveLibrary([album("al-1")], { "al-1": [] });
    await expect(syncLibrary(server(), CRED)).resolves.toBeDefined();
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

    await syncLibrary(server(), CRED);
    db().executeCount = 0;
    const second = await syncLibrary(server(), CRED);

    // Zero executes also proves scanForIssues and rebuildTagVocabCache stayed out: both are
    // whole-table sweeps gated on albumsChanged || tracksChanged.
    expect(db().executeCount).toBe(0);
    expect(second.changed).toEqual({ albums: false, tracks: false, artists: false, loved: false, playlists: false });
  });

  it("treats a SQLite integer year and an API string year as the same value", async () => {
    serveLibrary([album("al-1", { year: 2020 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    serveLibrary([album("al-1", { year: "2020" as unknown as number })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    db().executeCount = 0;
    expect((await syncLibrary(server(), CRED)).changed.albums).toBe(false);
    expect(db().executeCount).toBe(0);
  });

  it("treats a stored null artist and an empty-string artist as the same value", async () => {
    serveLibrary([album("al-1", { artist: "" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    db().raw.exec(`UPDATE albums SET artist = NULL WHERE id = '${SRV}:al-1'`);
    db().executeCount = 0;
    expect((await syncLibrary(server(), CRED)).changed.albums).toBe(false);
  });

  it("rewrites the album row when a compared column really moved", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    serveLibrary([album("al-1", { name: "Renamed" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const second = await syncLibrary(server(), CRED);
    expect(second.changed.albums).toBe(true);
    const rows = await db().select<{ name: string }[]>("SELECT name FROM albums");
    expect(rows[0]?.name).toBe("Renamed");
  });

  it("rebuilds the FTS row for a renamed album even when no track was fetched", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    serveLibrary([album("al-1", { name: "Renamed" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mAlbumTracks.mockClear();
    await syncLibrary(server(), CRED);
    // The skip heuristic held (no track fetch), but the FTS row carries the album name.
    expect(mAlbumTracks).not.toHaveBeenCalled();
    const fts = await db().select<{ album: string }[]>("SELECT album FROM tracks_fts LIMIT 1");
    expect(fts[0]?.album).toBe("Renamed");
  });

  it("does not rebuild the artists table when only a non-artist column changed", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    serveLibrary([album("al-1", { name: "Renamed" })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const second = await syncLibrary(server(), CRED);
    expect(second.changed.artists).toBe(false);
  });
});

describe("syncLibrary album prune", () => {
  async function seedTwoAlbums(): Promise<void> {
    serveLibrary([album("al-1"), album("al-2")], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      "al-2": [track("t3", "al-2"), track("t4", "al-2")],
    });
    await syncLibrary(server(), CRED);
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
      INSERT INTO album_covers (album_id, data_url, cached_at) VALUES ('${SRV}:al-2', 'data:x', 1);
    `);

    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const result = await syncLibrary(server(), CRED);

    expect(result.prunedAlbums).toBe(1);
    expect(await ids("SELECT id FROM albums")).toEqual([`${SRV}:al-1`]);
    expect(await count("tracks", "WHERE album_id = ?", [`${SRV}:al-2`])).toBe(0);
    expect(await count("tracks_fts", "WHERE id LIKE '%t3'")).toBe(0);
    const albumKeyed: [string, string][] = [
      ["loved_albums", "album_id"], ["album_genres", "album_id"], ["album_unresolved_genres", "album_id"],
      ["album_covers", "album_id"],
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
      INSERT INTO album_genre_exclusions (album_id, canonical_id) VALUES ('${SRV}:al-2', 'pop');
      INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES ('${SRV}:t3', 'T', 'A', 1);
      INSERT INTO scrobble_history (track_id, timestamp) VALUES ('${SRV}:t3', 1);
    `);
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    for (const table of ["album_identity", "album_user_genres", "album_genre_exclusions", "scrobble_queue", "scrobble_history"]) {
      expect({ table, rows: await count(table) }).toEqual({ table, rows: 1 });
    }
  });

  it("refuses to prune when the server returns an empty album list", async () => {
    await seedTwoAlbums();
    serveLibrary([], {});
    const result = await syncLibrary(server(), CRED);
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
    await expect(syncLibrary(server(), CRED)).rejects.toThrow(/500/);
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
    const result = await syncLibrary(server(), CRED);
    expect(result.prunedAlbums).toBe(0);
    expect(await count("albums", "WHERE server_id = ?", [OTHER])).toBe(1);
  });

  it("scopes the artists rebuild to its own server", async () => {
    db().raw.exec(
      `INSERT INTO artists (id, server_id, server_type, name, album_count) VALUES ('x', '${OTHER}', 'navidrome', 'Other Artist', 4)`
    );
    serveLibrary([album("al-1")], { "al-1": [] });
    await syncLibrary(server(), CRED);
    expect(await count("artists", "WHERE server_id = ?", [OTHER])).toBe(1);
  });

  it("excludes albums with no artist from the derived artists table", async () => {
    serveLibrary([album("al-1", { artist: "" }), album("al-2", { artist: "Real" })], {});
    await syncLibrary(server(), CRED);
    const rows = await db().select<{ name: string }[]>("SELECT name FROM artists");
    expect(rows.map((r) => r.name)).toEqual(["Real"]);
  });
});

describe("syncLibrary per-album track prune", () => {
  async function seedAlbumWithTracks(trackIds: string[]): Promise<void> {
    serveLibrary([album("al-1", { songCount: trackIds.length })], {
      "al-1": trackIds.map((id) => track(id, "al-1")),
    });
    await syncLibrary(server(), CRED);
  }

  it("removes tracks the album no longer contains, with their derived rows", async () => {
    await seedAlbumWithTracks(["t1", "t2", "t3"]);
    db().raw.exec(`INSERT INTO lyrics (track_id, plain, source, fetched_at) VALUES ('${SRV}:t3', 'la', 'lrclib', '2026-01-01')`);

    serveLibrary([album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    const result = await syncLibrary(server(), CRED);

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
    const result = await syncLibrary(server(), CRED);
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
    await syncLibrary(server(), CRED);
    // First sync: nothing to prune, so the round trip would be wasted once per album.
    expect(seen.filter((s) => /NOT IN/.test(s))).toHaveLength(0);

    seen.length = 0;
    serveLibrary([album("al-1", { created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    await syncLibrary(server(), CRED);
    expect(seen.filter((s) => /NOT IN/.test(s))).toHaveLength(1);
  });
});


describe("syncLibrary track id remap", () => {
  /**
   * Stands in for the `remap_track_ids` Rust command. A reimplementation, not the real
   * statements: `src-tauri/src/library_write/track_remap.rs` owns those and its own tests pin the table
   * state, including the rollback this double cannot model. It exists so these tests can read
   * back a mirror that actually carried the rows.
   */
  function applyNativeRemap(remaps: { oldId: string; newId: string }[]): number {
    let moved = 0;
    for (const { oldId, newId } of remaps) {
      for (const { table, column } of remappedTrackIdTables()) {
        db().raw.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(newId, oldId);
      }
      moved += db().raw.prepare("UPDATE OR IGNORE tracks SET id = ? WHERE id = ?").run(newId, oldId).changes;
    }
    return moved;
  }

  function armRemap(): { calls: { oldId: string; newId: string }[][] } {
    const calls: { oldId: string; newId: string }[][] = [];
    onInvoke("remap_track_ids", (args) => {
      const { remaps } = args as { remaps: { oldId: string; newId: string }[] };
      calls.push(remaps);
      return applyNativeRemap(remaps);
    });
    return { calls };
  }

  async function seedOneTrack(): Promise<void> {
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1", { path: "/m/1.flac" })] });
    await syncLibrary(server(), CRED);
    db().raw.exec(`
      INSERT INTO lyrics (track_id, plain, source, fetched_at) VALUES ('${SRV}:t1', 'la', 'lrclib', '2026-01-01');
      INSERT INTO scrobble_history (track_id, timestamp) VALUES ('${SRV}:t1', 1);
      INSERT INTO waveform_cache (track_id, peaks_json, created_at) VALUES ('${SRV}:t1', '[]', 1);
    `);
  }

  /** The album row is byte-identical across an id rewrite, so only `created` moves the skip. */
  function serveRenamed(newTrackId: string, path = "/m/1.flac"): void {
    serveLibrary([album("al-1", { songCount: 1, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track(newTrackId, "al-1", { path })],
    });
  }

  it("carries the user's rows onto a track id the server rewrote", async () => {
    await seedOneTrack();
    armRemap();

    serveRenamed("t1-rewritten");
    const result = await syncLibrary(server(), CRED);

    expect(result.remappedTracks).toBe(1);
    expect(await ids("SELECT id FROM tracks")).toEqual([`${SRV}:t1-rewritten`]);
    for (const table of ["lyrics", "scrobble_history", "waveform_cache"]) {
      expect({ table, rows: await count(table, "WHERE track_id = ?", [`${SRV}:t1-rewritten`]) }).toEqual({
        table,
        rows: 1,
      });
    }
    // The old row was carried, not deleted and rewritten, so the prune finds nothing stale.
    expect(result.prunedTracks).toBe(0);
  });

  it("asks the native side once, with every renamed track of the album", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], {
      "al-1": [track("t1", "al-1", { path: "/m/1.flac" }), track("t2", "al-1", { path: "/m/2.flac" })],
    });
    await syncLibrary(server(), CRED);
    const { calls } = armRemap();

    serveLibrary([album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1-new", "al-1", { path: "/m/1.flac" }), track("t2-new", "al-1", { path: "/m/2.flac" })],
    });
    await syncLibrary(server(), CRED);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      { oldId: `${SRV}:t1`, newId: `${SRV}:t1-new` },
      { oldId: `${SRV}:t2`, newId: `${SRV}:t2-new` },
    ]);
  });

  it("never asks when every mirrored id still resolves", async () => {
    await seedOneTrack();
    const { calls } = armRemap();

    serveLibrary([album("al-1", { songCount: 1, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1", { path: "/m/1.flac" })],
    });
    await syncLibrary(server(), CRED);

    expect(calls).toHaveLength(0);
    expect(invokeCount("remap_track_ids")).toBe(0);
  });

  it("leaves a genuinely deleted track to the prune", async () => {
    await seedOneTrack();
    const { calls } = armRemap();

    serveRenamed("t9", "/m/9.flac");
    const result = await syncLibrary(server(), CRED);

    expect(calls).toHaveLength(0);
    expect(result.remappedTracks).toBe(0);
    expect(result.prunedTracks).toBe(1);
    expect(await count("lyrics")).toBe(0);
  });

  it("leaves no search row behind under the id the server stopped using", async () => {
    await seedOneTrack();
    armRemap();

    serveRenamed("t1-rewritten");
    await syncLibrary(server(), CRED);

    // The track row was renamed, not deleted, so nothing else can ever reach the old FTS
    // row again: a search pool full of orphans joins back to no track at all.
    expect(await ids("SELECT id FROM tracks_fts ORDER BY id")).toEqual([`${SRV}:t1-rewritten`]);
  });

  it("keeps syncing when the native carry fails, leaving the rows to the prune", async () => {
    await seedOneTrack();
    onInvoke("remap_track_ids", () => {
      throw new Error("db locked");
    });

    serveRenamed("t1-rewritten");
    const result = await syncLibrary(server(), CRED);

    expect(result.remappedTracks).toBe(0);
    expect(result.prunedTracks).toBe(1);
    expect(await ids("SELECT id FROM tracks")).toEqual([`${SRV}:t1-rewritten`]);
  });
});

describe("clearSyncWatermark", () => {
  function seedServerRow(serverId: string): void {
    db().raw.exec(
      `INSERT INTO servers (id, type, url, display_name, username) VALUES ('${serverId}', 'navidrome', 'http://music.local', 'Music', 'user')`
    );
  }

  it("forgets the server identity, so the next sync reads every album's tracks", async () => {
    seedServerRow(SRV);
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1", { path: "/m/1.flac" })] });
    mScanStatus.mockResolvedValue({ serverVersion: "0.64.0", lastScan: "2026-09-01T00:00:00Z", songCount: 1 });
    await syncLibrary(server(), CRED);
    expect(
      (await db().select<{ server_version: string | null }[]>("SELECT server_version FROM servers WHERE id = ?", [SRV]))[0]
        ?.server_version
    ).toBe("0.64.0");

    await clearSyncWatermark(asDb(db()), SRV);

    const [row] = await db().select<{ last_scan_at: string | null; server_version: string | null; song_count: number | null }[]>(
      "SELECT last_scan_at, server_version, song_count FROM servers WHERE id = ?",
      [SRV]
    );
    expect(row).toEqual({ last_scan_at: null, server_version: null, song_count: null });
  });

  it("leaves another server's watermark alone", async () => {
    seedServerRow(SRV);
    seedServerRow(OTHER);
    db().raw.exec(`UPDATE servers SET server_version = '0.63.0' WHERE id = '${OTHER}'`);

    await clearSyncWatermark(asDb(db()), SRV);

    const [row] = await db().select<{ server_version: string | null }[]>(
      "SELECT server_version FROM servers WHERE id = ?",
      [OTHER]
    );
    expect(row?.server_version).toBe("0.63.0");
  });

  it("forgets which albums the last pass read, for this server only", async () => {
    seedServerRow(SRV);
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1", { path: "/m/1.flac" })] });
    mScanStatus.mockResolvedValue({ serverVersion: "0.64.0", lastScan: "2026-09-01T00:00:00Z", songCount: 1 });
    await syncLibrary(server(), CRED);
    db().raw.exec(
      `INSERT INTO albums (id, server_id, server_type, name, tracks_read_scan) VALUES ('${OTHER}:al-9', '${OTHER}', 'navidrome', 'Other', 'kept')`
    );

    await clearSyncWatermark(asDb(db()), SRV);

    const rows = await db().select<{ id: string; tracks_read_scan: string | null }[]>(
      "SELECT id, tracks_read_scan FROM albums ORDER BY id"
    );
    expect(rows).toEqual([
      { id: `${SRV}:al-1`, tracks_read_scan: null },
      { id: `${OTHER}:al-9`, tracks_read_scan: "kept" },
    ]);
  });
});

describe("syncLibrary forced track pass", () => {
  async function seedUnchangedLibrary(): Promise<void> {
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1", { path: "/m/1.flac" })] });
    await syncLibrary(server(), CRED);
    mAlbumTracks.mockClear();
  }

  it("reads every album again when the user asked for it, even with no scan status to compare", async () => {
    await seedUnchangedLibrary();

    const result = await syncLibrary(server(), CRED, undefined, { forceTrackPass: true });

    expect(result.skippedAlbums).toBe(0);
    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
  });

  it("still skips an unchanged album when nobody asked", async () => {
    await seedUnchangedLibrary();

    const result = await syncLibrary(server(), CRED);

    expect(result.skippedAlbums).toBe(1);
    expect(mAlbumTracks).not.toHaveBeenCalled();
  });

  it("spends no probe requests on a pass it is already going to make", async () => {
    await seedUnchangedLibrary();
    mSongExists.mockClear();

    await syncLibrary(server(), CRED, undefined, { forceTrackPass: true });

    expect(mSongExists).not.toHaveBeenCalled();
  });
});

describe("repairAlbumTrackIds", () => {
  function applyNativeRemap(remaps: { oldId: string; newId: string }[]): number {
    let moved = 0;
    for (const { oldId, newId } of remaps) {
      for (const { table, column } of remappedTrackIdTables()) {
        db().raw.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(newId, oldId);
      }
      moved += db().raw.prepare("UPDATE OR IGNORE tracks SET id = ? WHERE id = ?").run(newId, oldId).changes;
    }
    return moved;
  }

  async function seedAlbum(): Promise<void> {
    serveLibrary([album("al-1", { songCount: 2 })], {
      "al-1": [track("t1", "al-1", { path: "/m/1.flac" }), track("t2", "al-1", { path: "/m/2.flac" })],
    });
    await syncLibrary(server(), CRED);
    onInvoke("remap_track_ids", (args) => applyNativeRemap((args as { remaps: { oldId: string; newId: string }[] }).remaps));
  }

  it("re-resolves the album and reports which ids moved", async () => {
    await seedAlbum();
    db().raw.exec(`INSERT INTO lyrics (track_id, plain, source, fetched_at) VALUES ('${SRV}:t1', 'la', 'lrclib', '2026-01-01')`);
    mAlbumTracks.mockResolvedValue([
      track("t1-new", "al-1", { path: "/m/1.flac" }),
      track("t2", "al-1", { path: "/m/2.flac" }),
    ]);

    const remaps = await repairAlbumTrackIds(server(), CRED, `${SRV}:al-1`);

    expect(remaps).toEqual([{ oldId: `${SRV}:t1`, newId: `${SRV}:t1-new` }]);
    expect(await ids("SELECT id FROM tracks ORDER BY id")).toEqual([`${SRV}:t1-new`, `${SRV}:t2`]);
    expect(await count("lyrics", "WHERE track_id = ?", [`${SRV}:t1-new`])).toBe(1);
  });

  it("keeps the repaired album searchable under its new ids", async () => {
    await seedAlbum();
    mAlbumTracks.mockResolvedValue([
      track("t1-new", "al-1", { path: "/m/1.flac" }),
      track("t2", "al-1", { path: "/m/2.flac" }),
    ]);

    await repairAlbumTrackIds(server(), CRED, `${SRV}:al-1`);

    expect(await ids("SELECT id FROM tracks_fts ORDER BY id")).toEqual([`${SRV}:t1-new`, `${SRV}:t2`]);
  });

  it("drops a track the album really lost, rather than leaving it unplayable", async () => {
    await seedAlbum();
    mAlbumTracks.mockResolvedValue([track("t2", "al-1", { path: "/m/2.flac" })]);

    const remaps = await repairAlbumTrackIds(server(), CRED, `${SRV}:al-1`);

    expect(remaps).toEqual([]);
    expect(await ids("SELECT id FROM tracks")).toEqual([`${SRV}:t2`]);
  });

  it("reports nothing and writes no remap when the album is already right", async () => {
    await seedAlbum();
    const before = invokeCount("remap_track_ids");
    mAlbumTracks.mockResolvedValue([
      track("t1", "al-1", { path: "/m/1.flac" }),
      track("t2", "al-1", { path: "/m/2.flac" }),
    ]);

    expect(await repairAlbumTrackIds(server(), CRED, `${SRV}:al-1`)).toEqual([]);
    expect(invokeCount("remap_track_ids")).toBe(before);
  });

  it("refuses to prune when the album fetch comes back empty", async () => {
    await seedAlbum();
    mAlbumTracks.mockResolvedValue([]);

    expect(await repairAlbumTrackIds(server(), CRED, `${SRV}:al-1`)).toEqual([]);
    expect(await count("tracks")).toBe(2);
  });
});

describe("syncLibrary track upsert", () => {
  it("keeps the enrichment stamp on a track the track pass rewrites", async () => {
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1")] });
    await syncLibrary(server(), CRED);
    db().raw.exec(`UPDATE tracks SET tags_enriched_at = 1700 WHERE id = '${SRV}:t1'`);

    serveLibrary([album("al-1", { songCount: 1, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1")],
    });
    await syncLibrary(server(), CRED);

    const rows = await db().select<{ tags_enriched_at: number | null }[]>(
      "SELECT tags_enriched_at FROM tracks WHERE id = ?",
      [`${SRV}:t1`]
    );
    expect(rows[0]?.tags_enriched_at).toBe(1700);
  });

  it("leaves no track needing enrichment after a second track pass over unchanged tracks", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1")],
    });
    await syncLibrary(server(), CRED);
    db().raw.exec(`UPDATE tracks SET tags_enriched_at = 1700 WHERE album_id = '${SRV}:al-1'`);

    // Every later sync that touches this album re-runs the track pass; each one that
    // clears the stamp costs a full Last.fm enrichment round for the whole album.
    for (const created of ["2026-02-02T00:00:00Z", "2026-03-03T00:00:00Z"]) {
      serveLibrary([album("al-1", { songCount: 2, created })], {
        "al-1": [track("t1", "al-1"), track("t2", "al-1")],
      });
      await syncLibrary(server(), CRED);
    }

    expect(await count("tracks", "WHERE tags_enriched_at IS NULL")).toBe(0);
  });

  it("still writes the server-owned columns the track pass fetched", async () => {
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1", { title: "Old" })] });
    await syncLibrary(server(), CRED);

    serveLibrary([album("al-1", { songCount: 1, created: "2026-02-02T00:00:00Z" })], {
      "al-1": [track("t1", "al-1", { title: "New", playCount: 7 })],
    });
    await syncLibrary(server(), CRED);

    const rows = await db().select<{ title: string; play_count: number }[]>(
      "SELECT title, play_count FROM tracks WHERE id = ?",
      [`${SRV}:t1`]
    );
    expect(rows[0]).toEqual({ title: "New", play_count: 7 });
  });

  it("mirrors the server's last-played stamp, which counts plays from every client", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], {
      "al-1": [
        track("t1", "al-1", { played: "2026-09-09T08:59:52Z", playCount: 4 }),
        track("t2", "al-1"),
      ],
    });
    await syncLibrary(server(), CRED);

    const rows = await db().select<{ id: string; played_at: string | null }[]>(
      "SELECT id, played_at FROM tracks ORDER BY id"
    );
    expect(rows).toEqual([
      { id: `${SRV}:t1`, played_at: "2026-09-09T08:59:52Z" },
      { id: `${SRV}:t2`, played_at: null },
    ]);
  });
});

describe("syncLibrary track-skip heuristic", () => {
  it("skips an album whose created stamp and track count both match", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server(), CRED);
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(second.skippedAlbums).toBe(1);
  });

  it("re-fetches when the stored track count is one short of songCount", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    db().raw.exec(`DELETE FROM tracks WHERE id = '${SRV}:t2'`);
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server(), CRED);
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
    await syncLibrary(server(), CRED);

    const shrunk = album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" });
    serveLibrary([shrunk], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    const second = await syncLibrary(server(), CRED);
    expect(second.prunedTracks).toBe(1);

    mAlbumTracks.mockClear();
    const third = await syncLibrary(server(), CRED);
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(third.skippedAlbums).toBe(1);
  });

  it("never skips an album whose stored created stamp is null", async () => {
    serveLibrary([album("al-1", { created: undefined })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    mAlbumTracks.mockClear();
    await syncLibrary(server(), CRED);
    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
  });

  it("skips on the created stamp alone when the server omits songCount", async () => {
    serveLibrary([album("al-1", { songCount: undefined })], { "al-1": [track("t1", "al-1")] });
    await syncLibrary(server(), CRED);
    db().raw.exec(`DELETE FROM tracks WHERE id = '${SRV}:t1'`);
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server(), CRED);
    // No songCount means no count comparison is possible, so a track deletion goes unnoticed
    // until the album's `created` stamp moves.
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(second.skippedAlbums).toBe(1);
  });
});

describe("syncLibrary skip evidence", () => {
  /** The `servers` row every real sync has, and the watermark columns hang off. */
  function seedServerRow(): void {
    db().raw.exec(
      `INSERT INTO servers (id, type, url, display_name, username) VALUES ('${SRV}', 'navidrome', 'http://music.local', 'Music', 'user')`
    );
  }

  async function storedWatermark(): Promise<{
    last_scan_at: string | null;
    server_version: string | null;
    song_count: number | null;
  } | undefined> {
    const rows = await db().select<
      { last_scan_at: string | null; server_version: string | null; song_count: number | null }[]
    >("SELECT last_scan_at, server_version, song_count FROM servers WHERE id = ?", [SRV]);
    return rows[0];
  }

  const STATUS = { lastScan: "2026-09-13T03:00:26Z", songCount: 2, serverVersion: "0.64.0" };

  it("checks three mirrored ids against the server before trusting the skip", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    mSongExists.mockClear();
    mAlbumTracks.mockClear();
    db().executeCount = 0;
    const second = await syncLibrary(server(), CRED);

    // Two tracks in the mirror, so the sample is short of the three it asked for.
    expect(mSongExists).toHaveBeenCalledTimes(2);
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(second.skippedAlbums).toBe(1);
    // The probe is three reads and no writes: an idle sync stays at zero.
    expect(db().executeCount).toBe(0);
  });

  it("samples no more than three ids however large the mirror is", async () => {
    serveLibrary([album("al-1", { songCount: 5 })], {
      "al-1": ["t1", "t2", "t3", "t4", "t5"].map((id) => track(id, "al-1")),
    });
    await syncLibrary(server(), CRED);
    mSongExists.mockClear();
    await syncLibrary(server(), CRED);
    expect(mSongExists).toHaveBeenCalledTimes(3);
  });

  it("runs every album's track pass when one sampled id is gone from the server", async () => {
    // Navidrome 0.64 rewrote track ids while leaving album rows byte-identical, so the
    // per-album skip matched for the whole library and the mirror could never heal.
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    mSongExists.mockResolvedValueOnce(false);
    serveLibrary([album("al-1", { songCount: 2 })], {
      "al-1": [track("new1", "al-1"), track("new2", "al-1")],
    });
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server(), CRED);

    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
    expect(second.skippedAlbums).toBe(0);
    expect(await ids("SELECT id FROM tracks ORDER BY id")).toEqual([`${SRV}:new1`, `${SRV}:new2`]);
  });

  it("keeps skipping when the probe itself could not reach the server", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    // A transport failure says nothing about the id. Reading it as a miss would turn every
    // offline moment into a full pass over the whole library.
    mSongExists.mockResolvedValue(null);
    mAlbumTracks.mockClear();
    const second = await syncLibrary(server(), CRED);
    expect(mAlbumTracks).not.toHaveBeenCalled();
    expect(second.skippedAlbums).toBe(1);
  });

  it("probes nothing on a first sync, when there is no mirrored id to probe", async () => {
    serveLibrary([album("al-1", { songCount: 1 })], { "al-1": [track("t1", "al-1")] });
    await syncLibrary(server(), CRED);
    expect(mSongExists).not.toHaveBeenCalled();
  });

  it("writes nothing on an idle sync whose scan status is unchanged", async () => {
    seedServerRow();
    mScanStatus.mockResolvedValue(STATUS);
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    expect(await storedWatermark()).toEqual({
      last_scan_at: STATUS.lastScan,
      server_version: STATUS.serverVersion,
      song_count: STATUS.songCount,
    });

    db().executeCount = 0;
    const second = await syncLibrary(server(), CRED);
    expect(db().executeCount).toBe(0);
    expect(second.skippedAlbums).toBe(1);
  });

  it("runs every track pass on a server version bump, with album rows byte-identical", async () => {
    seedServerRow();
    mScanStatus.mockResolvedValue(STATUS);
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    mScanStatus.mockResolvedValue({ ...STATUS, serverVersion: "0.65.0" });
    mAlbumTracks.mockClear();
    mSongExists.mockClear();
    const second = await syncLibrary(server(), CRED);

    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
    expect(second.skippedAlbums).toBe(0);
    // A pass that is already forced has nothing left to learn from the probe.
    expect(mSongExists).not.toHaveBeenCalled();
    expect((await storedWatermark())?.server_version).toBe("0.65.0");
  });

  it("runs every track pass when the scan stamp moved and the album rows did not", async () => {
    seedServerRow();
    mScanStatus.mockResolvedValue(STATUS);
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    mScanStatus.mockResolvedValue({ ...STATUS, lastScan: "2026-09-14T03:00:00Z" });
    mAlbumTracks.mockClear();
    expect((await syncLibrary(server(), CRED)).skippedAlbums).toBe(0);
    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
  });

  it("forces a track pass for a library mirrored before the watermark existed", async () => {
    // The upgrade path: rows written by an older build carry no watermark at all, which is
    // the state every install hit by the id migration is in.
    seedServerRow();
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    expect((await storedWatermark())?.server_version).toBeNull();

    mScanStatus.mockResolvedValue(STATUS);
    mAlbumTracks.mockClear();
    expect((await syncLibrary(server(), CRED)).skippedAlbums).toBe(0);
    expect(mAlbumTracks).toHaveBeenCalledTimes(1);
  });

  describe("an interrupted track pass", () => {
    const LIBRARY = Array.from({ length: 10 }, (_, i) => album(`al-${i}`, { songCount: 1 }));

    /** A pass under STATUS that reads three albums and then hits the failure limit. */
    async function interruptedPass(): Promise<void> {
      seedServerRow();
      mScanStatus.mockResolvedValue(STATUS);
      mAllAlbums.mockResolvedValue(LIBRARY);
      let call = 0;
      mAlbumTracks.mockImplementation(async (_u, _n, _c, albumId) => {
        if (++call > 3) throw new Error("timed out");
        return [track(`t-${albumId}`, albumId)];
      });
      expect((await syncLibrary(server(), CRED)).albumTracksIncomplete).toBe(true);
      mAlbumTracks.mockReset();
      mAlbumTracks.mockImplementation(async (_u, _n, _c, albumId) => [track(`t-${albumId}`, albumId)]);
    }

    it("picks up where it stopped instead of starting over", async () => {
      await interruptedPass();

      const second = await syncLibrary(server(), CRED);

      expect(mAlbumTracks).toHaveBeenCalledTimes(7);
      expect(second.skippedAlbums).toBe(3);
      // The resumed half completes the pass, so the watermark may finally move.
      expect((await storedWatermark())?.last_scan_at).toBe(STATUS.lastScan);
    });

    it("writes each album's progress in one statement per pass, not one per album", async () => {
      await interruptedPass();
      const writesBefore = db().queryLog.length;

      await syncLibrary(server(), CRED);

      const progressWrites = db()
        .queryLog.slice(writesBefore)
        .filter((q) => q.kind === "execute" && q.sql.includes("tracks_read_scan"));
      expect(progressWrites.length).toBe(1);
    });

    it("starts over when the server identity moved since the interruption", async () => {
      await interruptedPass();
      mScanStatus.mockResolvedValue({ ...STATUS, lastScan: "2026-09-14T03:00:00Z" });

      await syncLibrary(server(), CRED);

      expect(mAlbumTracks).toHaveBeenCalledTimes(10);
    });

    it("still reads every album when the user asks for a resync", async () => {
      await interruptedPass();

      await syncLibrary(server(), CRED, undefined, { forceTrackPass: true });

      expect(mAlbumTracks).toHaveBeenCalledTimes(10);
    });

    it("repeats an interrupted resync over the albums it never reached", async () => {
      await interruptedPass();
      await syncLibrary(server(), CRED);

      await clearSyncWatermark(asDb(db()), SRV);
      let call = 0;
      mAlbumTracks.mockReset();
      mAlbumTracks.mockImplementation(async (_u, _n, _c, albumId) => {
        if (++call > 3) throw new Error("timed out");
        return [track(`t-${albumId}`, albumId)];
      });
      expect(
        (await syncLibrary(server(), CRED, undefined, { forceTrackPass: true })).albumTracksIncomplete
      ).toBe(true);
      mAlbumTracks.mockReset();
      mAlbumTracks.mockImplementation(async (_u, _n, _c, albumId) => [track(`t-${albumId}`, albumId)]);

      // Stamps from the pass before the resync must not pass for the resync's own progress.
      await syncLibrary(server(), CRED);

      expect(mAlbumTracks).toHaveBeenCalledTimes(7);
    });

    it("does not let progress stand in for the id probe after a completed pass", async () => {
      await interruptedPass();
      await syncLibrary(server(), CRED);
      mAlbumTracks.mockClear();

      // Same identity, every album carries its stamp, and the ids still stopped resolving:
      // the stamp says when an album was read, not that the ids read then are still good.
      mSongExists.mockResolvedValue(false);
      await syncLibrary(server(), CRED);

      expect(mAlbumTracks).toHaveBeenCalledTimes(10);
    });
  });

  it("keeps the stored watermark when the scan status cannot be read", async () => {
    seedServerRow();
    mScanStatus.mockResolvedValue(STATUS);
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    mScanStatus.mockRejectedValue(new Error("not an admin"));
    await syncLibrary(server(), CRED);
    expect(await storedWatermark()).toEqual({
      last_scan_at: STATUS.lastScan,
      server_version: STATUS.serverVersion,
      song_count: STATUS.songCount,
    });
  });

  it("does not move the watermark on a pass that lost an album to a failure", async () => {
    seedServerRow();
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);

    // Storing it here would tell the next sync this album was read when it was not, and the
    // evidence that it still needs reading is exactly what the watermark would have erased.
    mScanStatus.mockResolvedValue(STATUS);
    mAlbumTracks.mockRejectedValue(new Error("offline"));
    const second = await syncLibrary(server(), CRED);
    expect(second.failedAlbums).toBe(1);
    expect((await storedWatermark())?.server_version).toBeNull();
  });
});

describe("syncLibrary album track failures", () => {
  function libraryOf(n: number): NavidromeAlbum[] {
    return Array.from({ length: n }, (_, i) => album(`al-${i}`, { songCount: 1 }));
  }

  it("gives up on the album pass after five consecutive failures", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(10));
    mAlbumTracks.mockRejectedValue(new Error("timeout"));
    const result = await syncLibrary(server(), CRED);
    expect(mAlbumTracks).toHaveBeenCalledTimes(5);
    expect(result.failedAlbums).toBe(5);
    expect(result.albumTracksIncomplete).toBe(true);
  });

  it("stops on an open breaker without counting its refusals as album failures", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(10));
    let call = 0;
    mAlbumTracks.mockImplementation(async () => {
      call++;
      if (call <= 2) throw new Error("getAlbum failed after 3 attempts: timed out after 12000ms");
      throw new TransportStalledError("getAlbum not attempted: Requests to x are timing out.");
    });
    const result = await syncLibrary(server(), CRED);
    // The refusal costs no time and names no album, so one is enough to stop, and it is
    // not the fifth failure that would have blamed three albums the server never saw.
    expect(mAlbumTracks).toHaveBeenCalledTimes(3);
    expect(result.failedAlbums).toBe(2);
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
    const result = await syncLibrary(server(), CRED);
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
    const result = await syncLibrary(server(), CRED);
    // Six failures total, never five in a row: a naive `failedAlbums >= 5` breaks here.
    expect(result.failedAlbums).toBe(6);
    expect(result.albumTracksIncomplete).toBe(false);
    expect(mAlbumTracks).toHaveBeenCalledTimes(8);
  });

  it("leaves an album's existing tracks alone when its fetch fails", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    serveLibrary([album("al-1", { songCount: 2, created: "2026-02-02T00:00:00Z" })], {});
    mAlbumTracks.mockRejectedValue(new Error("timeout"));
    const second = await syncLibrary(server(), CRED);
    expect(second.failedAlbums).toBe(1);
    expect(await count("tracks")).toBe(2);
  });

  it("reports progress against the number of albums that actually need tracks", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(3));
    mAlbumTracks.mockResolvedValue([]);
    const progress: { done: number; total: number }[] = [];
    await syncLibrary(server(), CRED, (p) => progress.push(p));
    expect(progress[0]).toEqual({ done: 0, total: 3 });
    expect(progress[1]).toEqual({ done: 1, total: 3 });
  });

  it("runs without a progress callback", async () => {
    mAllAlbums.mockResolvedValue(libraryOf(2));
    mAlbumTracks.mockResolvedValue([]);
    await expect(syncLibrary(server(), CRED)).resolves.toBeDefined();
  });
});


describe("syncLibrary album progress reporting", () => {
  function libraryOf(n: number): NavidromeAlbum[] {
    return Array.from({ length: n }, (_, i) => album(`al-${i}`, { songCount: 1 }));
  }

  /** Every tick one run emits, in order. */
  async function ticksFor(albums: NavidromeAlbum[]): Promise<SyncProgress[]> {
    mAllAlbums.mockResolvedValue(albums);
    const ticks: SyncProgress[] = [];
    await syncLibrary(server(), CRED, (p) => ticks.push(p));
    return ticks;
  }

  it("finishes on the total rather than the last multiple of the notify interval", async () => {
    mAlbumTracks.mockResolvedValue([]);
    const ticks = await ticksFor(libraryOf(3));
    expect(ticks[ticks.length - 1]).toEqual({ done: 3, total: 3 });
  });

  it("leaves the bar short of the total when the album pass gives up early", async () => {
    mAlbumTracks.mockRejectedValue(new Error("timeout"));
    const ticks = await ticksFor(libraryOf(6));
    // Five attempts then the consecutive-failure break: a bar stuck at 5/6 is the
    // signal `albumTracksIncomplete` carries, so it must not be rounded up to 6.
    expect(ticks[ticks.length - 1]).toEqual({ done: 5, total: 6 });
  });

  it("says the pass has started when the album rows are unchanged and only tracks are missing", async () => {
    serveLibrary([album("al-1", { songCount: 2 })], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    await syncLibrary(server(), CRED);
    await db().execute("DELETE FROM tracks WHERE id = ?", [`${SRV}:t2`]);

    mAlbumTracks.mockResolvedValue([track("t1", "al-1"), track("t2", "al-1")]);
    const ticks = await ticksFor([album("al-1", { songCount: 2 })]);
    expect(ticks[0]).toEqual({ done: 0, total: 1 });
  });

  it("does not repeat the last interval tick when the album count divides evenly", async () => {
    mAlbumTracks.mockResolvedValue([]);
    const ticks = await ticksFor(libraryOf(25));
    // Start, the first fetch, and the 25th: the final report is the 25th itself.
    expect(ticks).toEqual([
      { done: 0, total: 25 },
      { done: 1, total: 25 },
      { done: 25, total: 25 },
    ]);
  });
});

describe("syncLibrary loved stage", () => {
  it("reaches equality again on a starred id with no local track row", async () => {
    // The write inserts every starred id the server reported; a read scoped by a join to
    // tracks could never see the orphan, so the counts never matched and both loved tables
    // were rewritten on every 5-minute tick forever.
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }, { id: "gone" }], album: [] });
    await syncLibrary(server(), CRED);
    expect(await count("loved_tracks")).toBe(2);

    const second = await syncLibrary(server(), CRED);
    expect(second.changed.loved).toBe(false);
    db().executeCount = 0;
    const third = await syncLibrary(server(), CRED);
    expect(third.changed.loved).toBe(false);
    expect(db().executeCount).toBe(0);
  });

  it("rewrites loved state when the server's starred set really moved", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }] });
    await syncLibrary(server(), CRED);
    mStarred.mockResolvedValue({ song: [{ id: "t2" }] });
    const second = await syncLibrary(server(), CRED);
    expect(second.changed.loved).toBe(true);
    expect(await ids("SELECT track_id AS id FROM loved_tracks")).toEqual([`${SRV}:t2`]);
  });

  it("detects an equal-sized but disjoint starred set", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t2", "al-1")] });
    mStarred.mockResolvedValue({ album: [{ id: "al-1" }] });
    await syncLibrary(server(), CRED);
    mStarred.mockResolvedValue({ album: [{ id: "al-9" }] });
    const second = await syncLibrary(server(), CRED);
    expect(second.changed.loved).toBe(true);
    expect(await ids("SELECT album_id AS id FROM loved_albums")).toEqual([`${SRV}:al-9`]);
  });

  it("does not delete another server's loved rows", async () => {
    db().raw.exec(`INSERT INTO loved_tracks (track_id) VALUES ('${OTHER}:t9')`);
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }] });
    await syncLibrary(server(), CRED);
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

    await syncLibrary(server(WILD), CRED);

    expect(await count("loved_tracks", "WHERE track_id = ?", ["srv-a:t9"])).toBe(1);
    expect(await count("loved_albums", "WHERE album_id = ?", ["srv-a:al-9"])).toBe(1);
    // Positive control: the wildcard server's own row was still written, so the assertions
    // above are not passing against a sync that did nothing.
    expect(await count("loved_tracks", "WHERE track_id = ?", [`${WILD}:t1`])).toBe(1);
  });

  it("keeps stored loved state and reports the stage when the starred fetch fails", async () => {
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1")] });
    mStarred.mockResolvedValue({ song: [{ id: "t1" }] });
    await syncLibrary(server(), CRED);

    mStarred.mockRejectedValue(new Error("offline"));
    const second = await syncLibrary(server(), CRED);
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
    await syncLibrary(server(), CRED);
  }

  it("keeps Canon-owned playlist columns across a refresh that changed the name", async () => {
    // The server payload knows nothing about is_smart / rules_json / custom_cover_data, so a
    // DELETE-then-INSERT silently turned a smart playlist into an ordinary one.
    await seedPlaylists();
    db().raw.exec(
      `UPDATE playlists SET is_smart = 1, rules_json = '{"r":1}', custom_cover_data = 'data:png' WHERE id = '${SRV}:pl-1'`
    );
    mPlaylists.mockResolvedValue([pl("pl-1", { name: "Renamed" }), pl("pl-2")]);
    const second = await syncLibrary(server(), CRED);

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
    await syncLibrary(server(), CRED);

    expect(deletes).toEqual([`${SRV}:pl-2`]);
  });

  it("writes contiguous positions after a mid-list removal", async () => {
    serveLibrary([album("al-1")], {
      "al-1": [track("t1", "al-1"), track("t2", "al-1"), track("t3", "al-1")],
    });
    mPlaylists.mockResolvedValue([pl("pl-1", { songCount: 3 })]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1"), track("t2", "al-1"), track("t3", "al-1")]);
    await syncLibrary(server(), CRED);

    mPlaylists.mockResolvedValue([pl("pl-1", { songCount: 2 })]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1"), track("t3", "al-1")]);
    await syncLibrary(server(), CRED);

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

  it("closes the position hole an album prune punched in a playlist", async () => {
    // The album prune deletes the playlist_tracks rows of every track it drops, but not the
    // positions of the rows around them. The server drops the same track from the playlist,
    // so the ordered id lists match on both sides and every change gate here used to say
    // "nothing moved" - leaving 0, 2 stored where the server has 0, 1. `position` is the
    // songIndexToRemove PlaylistDetail sends, so the next removal deletes the wrong track.
    serveLibrary([album("al-1"), album("al-2")], {
      "al-1": [track("t1", "al-1"), track("t3", "al-1")],
      "al-2": [track("t2", "al-2")],
    });
    mPlaylists.mockResolvedValue([pl("pl-1", { songCount: 3 })]);
    mPlaylistTracks.mockResolvedValue([
      track("t1", "al-1"),
      track("t2", "al-2"),
      track("t3", "al-1"),
    ]);
    await syncLibrary(server(), CRED);
    expect(await ids("SELECT track_id AS id FROM playlist_tracks ORDER BY position")).toEqual([
      `${SRV}:t1`, `${SRV}:t2`, `${SRV}:t3`,
    ]);

    // al-2 is gone server side. Everything the playlist gates compare - name, comment,
    // cover, the reported song count and the ordered id list - reads identical afterwards.
    serveLibrary([album("al-1")], { "al-1": [track("t1", "al-1"), track("t3", "al-1")] });
    mPlaylists.mockResolvedValue([pl("pl-1", { songCount: 3 })]);
    mPlaylistTracks.mockResolvedValue([track("t1", "al-1"), track("t3", "al-1")]);
    await syncLibrary(server(), CRED);

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
    await syncLibrary(server(), CRED);
    expect(await ids("SELECT id FROM playlists")).toEqual([`${SRV}:pl-1`]);
    expect(await count("playlist_tracks", "WHERE playlist_id = ?", [`${SRV}:pl-2`])).toBe(0);
    expect(await count("playlist_resume")).toBe(0);
  });

  it("keeps stored playlists and reports the stage when the listing fetch fails", async () => {
    await seedPlaylists();
    mPlaylists.mockRejectedValue(new Error("offline"));
    const second = await syncLibrary(server(), CRED);
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
    const second = await syncLibrary(server(), CRED);

    // An incomplete picture must not reach the prune: pl-2 would be erased outright.
    expect(second.failedPlaylists).toBe(1);
    expect(second.changed.playlists).toBe(false);
    // The blocked write is the same one the listing failure reports, so it owes the
    // caller the same stage: otherwise this is indistinguishable from "nothing changed".
    expect(second.skippedStages).toEqual(["playlists"]);
    const rows = await db().select<{ name: string }[]>("SELECT name FROM playlists ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(["Playlist pl-1", "Playlist pl-2"]);
  });

  it("reports a paused connection as a skipped stage, not as failed playlists", async () => {
    await seedPlaylists();
    mPlaylists.mockResolvedValue([pl("pl-1"), pl("pl-2")]);
    mPlaylistTracks.mockRejectedValue(new TransportStalledError("getPlaylist not attempted"));
    const second = await syncLibrary(server(), CRED);

    expect(second.failedPlaylists).toBe(0);
    expect(second.skippedStages).toEqual(["playlists"]);
    expect(second.changed.playlists).toBe(false);
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
    const result = await syncLibrary(server(), CRED);
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
    await syncLibrary(server(), CRED);
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
