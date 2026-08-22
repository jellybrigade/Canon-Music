// @vitest-environment jsdom
/**
 * Baseline coverage for `src/hooks/usePlaylistTracks.ts` - the SQLite-mirror read of a
 * playlist's track list, and the removal path that keeps `playlist_tracks.position` gapless.
 *
 * Regressions pinned (known-issues.md):
 *  - "`playlist_tracks.position` doubles as remote Subsonic index; a local hole desyncs the
 *    second removal." The tests below assert the *sequence of remote indexes sent* across two
 *    removals, not just the final table state, because the table state alone cannot prove the
 *    remote index was right.
 *  - "A mirror not scoped by owner depends entirely on its delete path." The load query
 *    carries `playlist_id = ?`.
 *
 * The removal's own SQL - the delete, the two negative-space compaction passes and the
 * `track_count` decrement - moved to the `playlist_remove_track` Rust command so it can run in
 * one transaction, and `src-tauri/src/library_write.rs` owns its table-state coverage. What is
 * left here is the hook's half of the contract: the server is told first, the command is
 * invoked once, and both session ticks fire so the list re-reads.
 *
 * Adjacent but out of scope: the playlist-refresh DELETE-then-INSERT entry belongs to
 * `src/lib/sync.ts` - this hook never writes `playlists` columns other than `track_count`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/navidrome", async () => {
  const actual = await vi.importActual<typeof import("../lib/navidrome")>("../lib/navidrome");
  return { ...actual, removeTrackFromNavidromePlaylist: vi.fn() };
});

import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { invoke, onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { removeTrackFromNavidromePlaylist, type NavidromeCredential } from "../lib/navidrome";
import { usePlaylistSessionStore } from "../store/playlistSessionStore";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "./useServer";
import { usePlaylistTracks } from "./usePlaylistTracks";

const SRV: Server = {
  id: "srv-a",
  type: "navidrome",
  url: "https://music.example",
  alt_url: null,
  display_name: "Home",
  username: "marcel",
  created_at: "2026-01-01T00:00:00Z",
};

const SRV_B: Server = { ...SRV, id: "srv-b", display_name: "Away" };

const CRED: NavidromeCredential = { type: "md5", token: "tok", salt: "salt" };

function swc(server: Server = SRV): ServerWithCredential {
  return { server, credential: CRED };
}

let db: FakeDatabase;

/** Seeds a track and, unless `albumId` is null, the album it belongs to. Ids are native. */
function seedTrack(nativeId: string, albumId: string | null = `${nativeId}-alb`, server: Server = SRV) {
  const canonId = `${server.id}:${nativeId}`;
  const canonAlbumId = albumId ? `${server.id}:${albumId}` : null;
  if (canonAlbumId) {
    db.raw
      .prepare(
        "INSERT OR IGNORE INTO albums (id, server_id, server_type, name, artwork_url) VALUES (?, ?, 'navidrome', ?, ?)"
      )
      .run(canonAlbumId, server.id, `album ${albumId}`, `art-${albumId}`);
  }
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, genre, year, track_number, duration, bit_rate, suffix)
       VALUES (?, ?, 'navidrome', ?, 'Some Artist', ?, 'Rock', 1999, 3, 210, 320, 'flac')`
    )
    .run(canonId, server.id, `title ${nativeId}`, canonAlbumId);
}

/** Seeds a track whose `album_id` points at an albums row that does not exist. */
function seedTrackWithMissingAlbum(nativeId: string, server: Server = SRV) {
  db.raw
    .prepare(
      "INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', ?, 'Some Artist', ?)"
    )
    .run(`${server.id}:${nativeId}`, server.id, `title ${nativeId}`, `${server.id}:ghost-alb`);
}

function seedPlaylist(nativeId: string, server: Server = SRV, trackCount = 0) {
  const canonId = `${server.id}:${nativeId}`;
  db.raw
    .prepare("INSERT INTO playlists (id, server_id, name, track_count) VALUES (?, ?, ?, ?)")
    .run(canonId, server.id, `playlist ${nativeId}`, trackCount);
  return canonId;
}

/** Puts native track ids into a playlist at consecutive 0-based positions. */
function seedPlaylistTracks(playlistId: string, nativeTrackIds: string[], server: Server = SRV) {
  const stmt = db.raw.prepare(
    "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)"
  );
  nativeTrackIds.forEach((nativeId, position) => stmt.run(playlistId, `${server.id}:${nativeId}`, position));
  db.raw
    .prepare("UPDATE playlists SET track_count = ? WHERE id = ?")
    .run(nativeTrackIds.length, playlistId);
}

function positionsOf(playlistId: string): { position: number; track_id: string }[] {
  return db.raw
    .prepare("SELECT position, track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC")
    .all(playlistId) as { position: number; track_id: string }[];
}

function trackCountOf(playlistId: string): number {
  return (
    db.raw.prepare("SELECT track_count FROM playlists WHERE id = ?").get(playlistId) as {
      track_count: number;
    }
  ).track_count;
}

/** Flushes the hook's async load IIFE. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Stands in for the `playlist_remove_track` Rust command. Deliberately a reimplementation and
 * not the real statements: `src-tauri/src/library_write.rs` owns those and its own tests pin
 * their table state, including the rollback this double cannot model. It exists so the two
 * tests that need a compacted table to read back from - the second-removal index and the
 * re-render - have one.
 */
function applyNativeRemoval(playlistId: string, position: number): void {
  db.raw.transaction(() => {
    db.raw
      .prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?")
      .run(playlistId, position);
    db.raw
      .prepare(
        "UPDATE playlist_tracks SET position = -(position - 1) WHERE playlist_id = ? AND position > ?"
      )
      .run(playlistId, position);
    db.raw
      .prepare("UPDATE playlist_tracks SET position = -position WHERE playlist_id = ? AND position < 0")
      .run(playlistId);
    db.raw
      .prepare("UPDATE playlists SET track_count = MAX(0, track_count - 1) WHERE id = ?")
      .run(playlistId);
  })();
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  resetTauriMocks();
  onInvoke("playlist_remove_track", (args) => {
    const { playlistId, position } = args as { playlistId: string; position: number };
    applyNativeRemoval(playlistId, position);
  });
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(removeTrackFromNavidromePlaylist).mockReset();
  vi.mocked(removeTrackFromNavidromePlaylist).mockResolvedValue(undefined);
  usePlaylistSessionStore.setState({ playlistsTick: 0, playlistTracksTick: 0 });
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

describe("usePlaylistTracks load effect", () => {
  it("returns an empty list without touching the database when no playlist is selected", async () => {
    const { result } = renderHook(() => usePlaylistTracks(null));

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    await flush();
    expect(db.selectCount).toBe(0);
  });

  it("starts in a loading state distinct from the empty state when a playlist is selected", async () => {
    const pl = seedPlaylist("pl1");
    const { result } = renderHook(() => usePlaylistTracks(pl));

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });

  it("reads the playlist's tracks in position order regardless of insertion order", async () => {
    const pl = seedPlaylist("pl1");
    ["a", "b", "c"].forEach((id) => seedTrack(id));
    // Inserted out of order on purpose: only ORDER BY pt.position can rescue this.
    db.raw
      .prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
      .run(pl, "srv-a:c", 2);
    db.raw
      .prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
      .run(pl, "srv-a:a", 0);
    db.raw
      .prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
      .run(pl, "srv-a:b", 1);

    const { result } = renderHook(() => usePlaylistTracks(pl));
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    expect(result.current.data!.map((r) => r.id)).toEqual(["srv-a:a", "srv-a:b", "srv-a:c"]);
    expect(result.current.data!.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("projects every column the row type declares, with the album columns aliased", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a", "alb1");
    seedPlaylistTracks(pl, ["a"]);

    const { result } = renderHook(() => usePlaylistTracks(pl));
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(result.current.data![0]).toEqual({
      id: "srv-a:a",
      title: "title a",
      artist: "Some Artist",
      duration: 210,
      genre: "Rock",
      year: 1999,
      track_number: 3,
      bit_rate: 320,
      suffix: "flac",
      position: 0,
      artwork_url: "art-alb1",
      album_name: "album alb1",
      album_id: "srv-a:alb1",
    });
  });

  it("keeps tracks whose album row is null or missing (the join on albums is a LEFT join)", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a", null); // album_id NULL
    seedTrackWithMissingAlbum("b"); // album_id set, albums row pruned
    seedTrack("c", "alb-c");
    seedPlaylistTracks(pl, ["a", "b", "c"]);

    const { result } = renderHook(() => usePlaylistTracks(pl));
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    const rows = result.current.data!;
    expect(rows.map((r) => r.id)).toEqual(["srv-a:a", "srv-a:b", "srv-a:c"]);
    expect(rows[0]!.album_id).toBeNull();
    expect(rows[0]!.album_name).toBeNull();
    expect(rows[1]!.album_id).toBeNull();
    expect(rows[1]!.artwork_url).toBeNull();
    expect(rows[2]!.album_name).toBe("album alb-c");
  });

  it("drops a playlist row whose track row is gone (the join on tracks is inner)", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    db.raw
      .prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
      .run(pl, "srv-a:vanished", 0);
    db.raw
      .prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
      .run(pl, "srv-a:a", 1);

    const { result } = renderHook(() => usePlaylistTracks(pl));
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(result.current.data![0]!.id).toBe("srv-a:a");
  });

  it("does not leak rows from another playlist holding the same positions", async () => {
    const plA = seedPlaylist("pl1", SRV);
    const plB = seedPlaylist("pl2", SRV_B);
    ["a", "b"].forEach((id) => seedTrack(id));
    ["x", "y"].forEach((id) => seedTrack(id, `${id}-alb`, SRV_B));
    seedPlaylistTracks(plA, ["a", "b"]);
    seedPlaylistTracks(plB, ["x", "y"], SRV_B);

    const { result } = renderHook(() => usePlaylistTracks(plA));
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(result.current.data!.map((r) => r.id)).toEqual(["srv-a:a", "srv-a:b"]);
  });

  it("blanks the list while switching playlists so the previous one is never shown under the new header", async () => {
    const plA = seedPlaylist("pl1");
    const plB = seedPlaylist("pl2");
    seedTrack("a");
    seedTrack("b");
    seedPlaylistTracks(plA, ["a"]);
    seedPlaylistTracks(plB, ["b"]);

    const { result, rerender } = renderHook(({ id }: { id: string | null }) => usePlaylistTracks(id), {
      initialProps: { id: plA as string | null },
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    rerender({ id: plB });
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]!.id).toBe("srv-a:b");
  });

  it("does not blank the list when only the refresh tick changes", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    seedPlaylistTracks(pl, ["a"]);

    const seen: (number | undefined)[] = [];
    const { result } = renderHook(() => {
      const r = usePlaylistTracks(pl);
      seen.push(r.data?.length);
      return r;
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    const before = db.selectCount;

    await act(async () => {
      usePlaylistSessionStore.getState().bumpPlaylistTracks();
    });
    await waitFor(() => expect(db.selectCount).toBe(before + 1));

    // Every render after the first successful load still had rows.
    expect(seen.slice(seen.indexOf(1))).not.toContain(undefined);
  });

  it("re-reads on the track tick but not on the playlists tick", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    seedPlaylistTracks(pl, ["a"]);

    const { result } = renderHook(() => usePlaylistTracks(pl));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(db.selectCount).toBe(1);

    await act(async () => {
      usePlaylistSessionStore.getState().bumpPlaylists();
    });
    await flush();
    expect(db.selectCount).toBe(1);

    await act(async () => {
      usePlaylistSessionStore.getState().bumpPlaylistTracks();
    });
    await waitFor(() => expect(db.selectCount).toBe(2));
  });

  it("re-blanks after a round trip through the null id, because the null branch clears the ref", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    seedPlaylistTracks(pl, ["a"]);

    const { result, rerender } = renderHook(({ id }: { id: string | null }) => usePlaylistTracks(id), {
      initialProps: { id: pl as string | null },
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    rerender({ id: null });
    expect(result.current.data).toEqual([]);

    rerender({ id: pl });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("keeps the previously loaded rows and stops loading when the query fails", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    seedPlaylistTracks(pl, ["a"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => usePlaylistTracks(pl));
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    vi.mocked(getDb).mockRejectedValueOnce(new Error("db gone"));
    await act(async () => {
      usePlaylistSessionStore.getState().bumpPlaylistTracks();
    });
    await waitFor(() => expect(errSpy).toHaveBeenCalled());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toHaveLength(1);
    expect(errSpy.mock.calls[0]![0]).toBe("usePlaylistTracks: failed to load tracks");
  });

  it("does not write state from a load that resolves after unmount", async () => {
    const pl = seedPlaylist("pl1");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    vi.mocked(getDb).mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(db as never);
      }) as never
    );

    const { unmount } = renderHook(() => usePlaylistTracks(pl));
    unmount();
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
    });

    // React logs an act/update-after-unmount warning through console.error if the
    // `cancelled` guard fails to hold.
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe("usePlaylistTracks removeTrack", () => {
  async function mount(playlistId: string) {
    const hook = renderHook(() => usePlaylistTracks(playlistId));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
  }

  it("sends the stripped playlist id and the raw position to the server", async () => {
    const pl = seedPlaylist("pl1");
    ["a", "b"].forEach((id) => seedTrack(id));
    seedPlaylistTracks(pl, ["a", "b"]);
    const { result } = await mount(pl);

    await act(async () => {
      await result.current.removeTrack(1, { id: pl }, swc());
    });

    expect(removeTrackFromNavidromePlaylist).toHaveBeenCalledWith(
      SRV.url,
      SRV.username,
      CRED,
      "pl1",
      1,
      undefined
    );
  });

  it("passes the alternate url through when the server has one", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    seedPlaylistTracks(pl, ["a"]);
    const { result } = await mount(pl);

    await act(async () => {
      await result.current.removeTrack(0, { id: pl }, swc({ ...SRV, alt_url: "https://alt.example" }));
    });

    expect(vi.mocked(removeTrackFromNavidromePlaylist).mock.calls[0]![5]).toBe("https://alt.example");
  });

  it("writes nothing locally when the server call fails", async () => {
    const pl = seedPlaylist("pl1");
    ["a", "b", "c"].forEach((id) => seedTrack(id));
    seedPlaylistTracks(pl, ["a", "b", "c"]);
    const { result } = await mount(pl);
    vi.mocked(removeTrackFromNavidromePlaylist).mockRejectedValueOnce(new Error("http 500"));

    await expect(result.current.removeTrack(1, { id: pl }, swc())).rejects.toThrow("http 500");

    expect(invoke).not.toHaveBeenCalled();
    expect(positionsOf(pl).map((r) => r.position)).toEqual([0, 1, 2]);
    expect(trackCountOf(pl)).toBe(3);
    expect(usePlaylistSessionStore.getState().playlistTracksTick).toBe(0);
    expect(usePlaylistSessionStore.getState().playlistsTick).toBe(0);
  });

  it("rejects before reaching the server when the playlist id carries a different server's prefix", async () => {
    const pl = seedPlaylist("pl1", SRV_B);
    const { result } = await mount(pl);

    await expect(result.current.removeTrack(0, { id: pl }, swc(SRV))).rejects.toThrow(/server prefix/);
    expect(removeTrackFromNavidromePlaylist).not.toHaveBeenCalled();
  });

  it("sends the compacted index on a second removal in the same session", async () => {
    // known-issues: "`playlist_tracks.position` doubles as remote Subsonic index; a local hole
    // desyncs the second removal." Without compaction the survivor B would still sit at
    // position 1 and the second removal would send index 1, deleting C server side.
    const pl = seedPlaylist("pl1");
    ["a", "b", "c"].forEach((id) => seedTrack(id));
    seedPlaylistTracks(pl, ["a", "b", "c"]);
    const { result } = await mount(pl);

    await act(async () => {
      await result.current.removeTrack(0, { id: pl }, swc());
    });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    // Remove whatever the list now renders first - exactly what the UI does.
    await act(async () => {
      await result.current.removeTrack(result.current.data![0]!.position, { id: pl }, swc());
    });

    expect(vi.mocked(removeTrackFromNavidromePlaylist).mock.calls.map((c) => c[4])).toEqual([0, 0]);
    expect(positionsOf(pl)).toEqual([{ position: 0, track_id: "srv-a:c" }]);
  });

  it("bumps both session ticks exactly once so the list and the sidebar both re-read", async () => {
    const pl = seedPlaylist("pl1");
    seedTrack("a");
    seedPlaylistTracks(pl, ["a"]);
    const { result } = await mount(pl);

    await act(async () => {
      await result.current.removeTrack(0, { id: pl }, swc());
    });

    expect(usePlaylistSessionStore.getState().playlistTracksTick).toBe(1);
    expect(usePlaylistSessionStore.getState().playlistsTick).toBe(1);
  });

  it("re-renders the list from the compacted table after a removal", async () => {
    const pl = seedPlaylist("pl1");
    ["a", "b", "c"].forEach((id) => seedTrack(id));
    seedPlaylistTracks(pl, ["a", "b", "c"]);
    const { result } = await mount(pl);
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    await act(async () => {
      await result.current.removeTrack(1, { id: pl }, swc());
    });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(result.current.data!.map((r) => r.position)).toEqual([0, 1]);
    expect(result.current.data!.map((r) => r.id)).toEqual(["srv-a:a", "srv-a:c"]);
  });

  it("invokes the removal command exactly once per removal", async () => {
    const pl = seedPlaylist("pl1");
    ["a", "b", "c"].forEach((id) => seedTrack(id));
    seedPlaylistTracks(pl, ["a", "b", "c"]);
    const { result } = await mount(pl);

    await act(async () => {
      await result.current.removeTrack(1, { id: pl }, swc());
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("playlist_remove_track", {
      playlistId: pl,
      position: 1,
    });
  });
});
