/**
 * The per-album track prune refuses to run at SQLite's bound-parameter ceiling, because a
 * `NOT IN` cannot be chunked without each chunk deleting what the other chunks keep
 * (`sync.ts::pruneAlbumTracks`). That is a boundary on one constant, so this file stubs
 * `SQLITE_MAX_VARIABLES` down to a number the assertion can reach in a few rows. Driving the
 * same boundary against the real 32000 seeds ~32k tracks through the migrated schema, the FTS
 * index and the tag scan - about 5s per case, none of which the assertion reads.
 *
 * Only the constant is stubbed; `executeBatched` and `executeIdChunks` stay real, so the write
 * path under test is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { album, server, SRV, track } from "../test/navidromeFixtures";
import type { NavidromeStarred } from "./navidrome";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../db", () => ({ getDb: async () => holder.db }));

// The factory is hoisted above every const in this file, so the stubbed value has to be a
// literal here; the cases read it back through the import below rather than restating it.
vi.mock("./db-batch", async () => ({
  ...(await vi.importActual<typeof import("./db-batch")>("./db-batch")),
  SQLITE_MAX_VARIABLES: 12,
}));

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
import { syncLibrary } from "./sync";
import { SQLITE_MAX_VARIABLES as CEILING } from "./db-batch";

const mAllAlbums = vi.mocked(fetchAllAlbums);
const mAlbumTracks = vi.mocked(fetchAlbumTracks);

function db(): FakeDatabase {
  if (!holder.db) throw new Error("test db not initialized");
  return holder.db;
}

async function count(where = "", params: unknown[] = []): Promise<number> {
  const rows = await db().select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM tracks ${where}`,
    params
  );
  return rows[0]?.c ?? 0;
}

/** Point the album-list and per-album track mocks at one canned album. */
function serveAlbum(tracks: ReturnType<typeof track>[], overrides = {}): void {
  mAllAlbums.mockResolvedValue([album("al-1", { songCount: tracks.length, ...overrides })]);
  mAlbumTracks.mockImplementation(async (_url, _user, _cred, albumId) =>
    albumId === "al-1" ? tracks : []
  );
}

beforeEach(async () => {
  resetTauriMocks();
  vi.clearAllMocks();
  holder.db = await createMigratedTestDb();
  onInvoke("get_credential", () => JSON.stringify({ type: "apikey", apiKey: "k" }));
  vi.mocked(fetchStarred2).mockResolvedValue({} as NavidromeStarred);
  vi.mocked(fetchPlaylists).mockResolvedValue([]);
  vi.mocked(fetchPlaylistTracks).mockResolvedValue([]);
  vi.mocked(fetchAndStoreOpenSubsonicExtensions).mockResolvedValue(undefined as never);

  serveAlbum([track("t1", "al-1"), track("t2", "al-1")]);
  await syncLibrary(server());
});

/** A replacement track list of `n` ids none of which the seeded album already holds. */
function replacement(n: number): ReturnType<typeof track>[] {
  return Array.from({ length: n }, (_, i) => track(`big${i}`, "al-1"));
}

describe("syncLibrary per-album track prune at the bound-parameter ceiling", () => {
  it("skips the prune rather than chunking a NOT IN at the variable ceiling", async () => {
    const many = replacement(CEILING - 1);
    serveAlbum(many, { created: "2026-02-02T00:00:00Z" });

    const result = await syncLibrary(server());

    expect(result.prunedTracks).toBe(0);
    // Positive control: the sync itself ran and wrote the new list, so the zero above is the
    // prune standing down and not the whole album pass being skipped.
    expect(await count("WHERE id = ?", [`${SRV}:big0`])).toBe(1);
    expect(await count("WHERE id IN (?, ?)", [`${SRV}:t1`, `${SRV}:t2`])).toBe(2);
  });

  it("still prunes one variable below the ceiling", async () => {
    const many = replacement(CEILING - 2);
    serveAlbum(many, { created: "2026-02-02T00:00:00Z" });

    const result = await syncLibrary(server());

    expect(result.prunedTracks).toBe(2);
    expect(await count("WHERE id = ?", [`${SRV}:big0`])).toBe(1);
    expect(await count("WHERE id IN (?, ?)", [`${SRV}:t1`, `${SRV}:t2`])).toBe(0);
  });
});
