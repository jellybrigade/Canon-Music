// @vitest-environment jsdom
/**
 * Baseline coverage for `src/hooks/useQueueSync.ts` - the server-side half of the
 * `queue.restore_on_startup` setting (the store-layer half, `loadSettings`, is covered in
 * `player.test.ts`).
 *
 * Regression pinned: known-issues "A restore path writing `currentTrack` without loading the
 * engine is unplayable" - `restoreQueue` must stay state-only (`streamUrl: null`,
 * `isPlaying: false`, no engine load), which is exactly the fix that entry documents for this
 * hook's own restore path.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/navidrome", async () => {
  const actual = await vi.importActual<typeof import("../lib/navidrome")>("../lib/navidrome");
  return { ...actual, getPlayQueue: vi.fn(), savePlayQueue: vi.fn() };
});

import { renderHook, act, cleanup } from "@testing-library/react";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { getPlayQueue, savePlayQueue, type SavedPlayQueue } from "../lib/navidrome";
import { usePlayerStore, type CurrentTrack } from "../store/player";
import type { NavidromeCredential } from "../lib/navidrome";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "./useServer";
import { useQueueSync } from "./useQueueSync";

const SRV: Server = {
  id: "srv-a",
  type: "navidrome",
  url: "https://music.example",
  alt_url: null,
  display_name: "Home",
  username: "marcel",
  created_at: "2026-01-01T00:00:00Z",
};

const CRED: NavidromeCredential = { type: "md5", token: "tok", salt: "salt" };

function swc(server: Server = SRV): ServerWithCredential {
  return { server, credential: CRED };
}

function savedQueue(overrides: Partial<SavedPlayQueue> = {}): SavedPlayQueue {
  return { trackIds: ["t1", "t2"], currentId: null, positionMs: 0, ...overrides };
}

function makeTrack(id: string): CurrentTrack {
  return { id, title: `Track ${id}`, artist: "Artist", duration: 200, albumId: "srv-a:alb", album: "Album" };
}

let db: FakeDatabase;

function setRestoreOnStartup(value: string | undefined) {
  if (value === undefined) return;
  db.raw.prepare("INSERT INTO settings (key, value) VALUES ('queue.restore_on_startup', ?)").run(value);
}

/** Seeds a track and, unless `albumId` is null, the album it belongs to. Ids are native (no server prefix). */
function seedTrack(nativeId: string, albumId: string | null = `${nativeId}-alb`, server: Server = SRV) {
  const canonId = `${server.id}:${nativeId}`;
  if (albumId) {
    const canonAlbumId = `${server.id}:${albumId}`;
    db.raw
      .prepare("INSERT OR IGNORE INTO albums (id, server_id, server_type, name) VALUES (?, ?, 'navidrome', ?)")
      .run(canonAlbumId, server.id, `album ${albumId}`);
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', ?, 'Some Artist', ?)")
      .run(canonId, server.id, `title ${nativeId}`, canonAlbumId);
  } else {
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', ?, 'Some Artist', NULL)")
      .run(canonId, server.id, `title ${nativeId}`);
  }
}

/** Flushes the async restore chain (and any due timers). */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function resetPlayerState() {
  usePlayerStore.setState({
    currentTrack: null,
    queue: [],
    queueIndex: -1,
    isPlaying: false,
    elapsed: 0,
  });
}

function renderSync(value: ServerWithCredential | undefined) {
  return renderHook(({ v }: { v: ServerWithCredential | undefined }) => useQueueSync(v), {
    initialProps: { v: value },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedTestDb();
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  vi.mocked(getPlayQueue).mockResolvedValue(null);
  vi.mocked(savePlayQueue).mockResolvedValue(undefined);
  resetPlayerState();
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  resetPlayerState();
  await db.close();
});

describe("useQueueSync restore", () => {
  it("does not query the server when restore_on_startup has no setting row", async () => {
    seedTrack("t1");
    seedTrack("t2");

    renderSync(swc());
    await tick();

    expect(getPlayQueue).not.toHaveBeenCalled();
  });

  it("does not query the server when restore_on_startup is false", async () => {
    setRestoreOnStartup("false");
    seedTrack("t1");

    renderSync(swc());
    await tick();

    expect(getPlayQueue).not.toHaveBeenCalled();
  });

  it("does not query the server when restore_on_startup is some other value", async () => {
    setRestoreOnStartup("1");

    renderSync(swc());
    await tick();

    expect(getPlayQueue).not.toHaveBeenCalled();
  });

  it("does not restore when playback is already under way", async () => {
    setRestoreOnStartup("true");
    usePlayerStore.setState({ isPlaying: true });

    renderSync(swc());
    await tick();

    expect(getPlayQueue).not.toHaveBeenCalled();
  });

  it("does not restore when a track is already loaded", async () => {
    setRestoreOnStartup("true");
    usePlayerStore.setState({ currentTrack: makeTrack("srv-a:t1") });

    renderSync(swc());
    await tick();

    expect(getPlayQueue).not.toHaveBeenCalled();
  });

  it("does not touch the store when the server has no saved queue", async () => {
    setRestoreOnStartup("true");
    vi.mocked(getPlayQueue).mockResolvedValue(null);

    renderSync(swc());
    await tick();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("does not touch the store when the saved queue's track ids match nothing local", async () => {
    setRestoreOnStartup("true");
    vi.mocked(getPlayQueue).mockResolvedValue(savedQueue({ trackIds: ["ghost1", "ghost2"] }));

    renderSync(swc());
    await tick();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().queue).toEqual([]);
  });

  // Regression, known-issues "A restore path writing `currentTrack` without loading the
  // engine is unplayable": the server-side restore fix is state-only - no streamUrl, no
  // isPlaying, no engine load.
  it("restores queue state only: no stream url, not playing", async () => {
    setRestoreOnStartup("true");
    seedTrack("t1");
    seedTrack("t2");
    vi.mocked(getPlayQueue).mockResolvedValue(savedQueue({ trackIds: ["t1", "t2"] }));

    renderSync(swc());
    await tick();

    const state = usePlayerStore.getState();
    expect(state.currentTrack).not.toBeNull();
    expect(state.queue.map((t) => t.id)).toEqual(["srv-a:t1", "srv-a:t2"]);
    expect(state.streamUrl).toBeNull();
    expect(state.isPlaying).toBe(false);
  });

  it("falls back to index 0 when the saved queue has no current id", async () => {
    setRestoreOnStartup("true");
    seedTrack("t1");
    seedTrack("t2");
    vi.mocked(getPlayQueue).mockResolvedValue(savedQueue({ trackIds: ["t1", "t2"], currentId: null }));

    renderSync(swc());
    await tick();

    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("srv-a:t1");
  });

  it("falls back to index 0 when the saved current id matches no local track", async () => {
    setRestoreOnStartup("true");
    seedTrack("t1");
    seedTrack("t2");
    vi.mocked(getPlayQueue).mockResolvedValue(savedQueue({ trackIds: ["t1", "t2"], currentId: "ghost" }));

    renderSync(swc());
    await tick();

    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it("restores at the saved current id's position", async () => {
    setRestoreOnStartup("true");
    seedTrack("t1");
    seedTrack("t2");
    vi.mocked(getPlayQueue).mockResolvedValue(savedQueue({ trackIds: ["t1", "t2"], currentId: "t2" }));

    renderSync(swc());
    await tick();

    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("srv-a:t2");
  });

  // Guard at the top of the async chain reads store state once at mount; a local restore that
  // lands during the network + DB round trip must win the race rather than get overwritten.
  it("does not clobber a currentTrack set while the restore is in flight", async () => {
    setRestoreOnStartup("true");
    seedTrack("t1");
    let resolveQueue!: (v: SavedPlayQueue | null) => void;
    vi.mocked(getPlayQueue).mockImplementation(
      () => new Promise((resolve) => { resolveQueue = resolve; })
    );

    renderSync(swc());
    await tick();

    // Simulate loadSettings' own local restore landing mid-flight.
    usePlayerStore.setState({ currentTrack: makeTrack("srv-a:local"), queue: [makeTrack("srv-a:local")] });

    await act(async () => {
      resolveQueue(savedQueue({ trackIds: ["t1"] }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(usePlayerStore.getState().currentTrack?.id).toBe("srv-a:local");
  });

  it("does not restore twice across a rerender that keeps the same server id", async () => {
    setRestoreOnStartup("true");
    seedTrack("t1");
    vi.mocked(getPlayQueue).mockResolvedValue(savedQueue({ trackIds: ["t1"] }));

    const { rerender } = renderSync(swc());
    await tick();
    expect(getPlayQueue).toHaveBeenCalledTimes(1);

    // A new object identity for the same server should not re-arm the restore effect
    // (its dep array is keyed on server.id alone).
    rerender({ v: swc() });
    await tick();

    expect(getPlayQueue).toHaveBeenCalledTimes(1);
  });
});

describe("useQueueSync debounced save", () => {
  it("arms no timer when nothing is playing", () => {
    renderSync(swc());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms no timer when the queue is empty", () => {
    usePlayerStore.setState({ currentTrack: makeTrack("srv-a:t1"), queue: [] });
    renderSync(swc());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saves the queue after 10s idle, with native ids, current id and elapsed ms", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({
      currentTrack: track,
      queue: [track, makeTrack("srv-a:t2")],
      elapsed: 12.5,
    });

    renderSync(swc());
    await tick(10_000);

    expect(savePlayQueue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savePlayQueue).mock.calls[0]).toEqual([
      "https://music.example",
      "marcel",
      CRED,
      ["t1", "t2"],
      "t1",
      12500,
      undefined,
    ]);
  });

  it("does not save before the 10s debounce elapses", async () => {
    usePlayerStore.setState({ currentTrack: makeTrack("srv-a:t1"), queue: [makeTrack("srv-a:t1")] });

    renderSync(swc());
    await tick(9_999);

    expect(savePlayQueue).not.toHaveBeenCalled();
  });

  it("resets the debounce window on a queue change, sending only the final queue once", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({ currentTrack: track, queue: [track] });

    const { rerender } = renderSync(swc());
    await tick(6_000);
    expect(savePlayQueue).not.toHaveBeenCalled();

    usePlayerStore.setState((s) => ({ queue: [...s.queue, makeTrack("srv-a:t2")] }));
    rerender({ v: swc() });
    await tick(6_000);
    expect(savePlayQueue).not.toHaveBeenCalled();

    await tick(4_000);
    expect(savePlayQueue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savePlayQueue).mock.calls[0]![3]).toEqual(["t1", "t2"]);
  });

  it("clears the pending debounce on unmount", async () => {
    usePlayerStore.setState({ currentTrack: makeTrack("srv-a:t1"), queue: [makeTrack("srv-a:t1")] });

    const { unmount } = renderSync(swc());
    unmount();
    await tick(10_000);

    expect(savePlayQueue).not.toHaveBeenCalled();
  });

  it("filters out queue entries not owned by the current server", async () => {
    const own = makeTrack("srv-a:t1");
    const foreign = makeTrack("srv-b:t9");
    usePlayerStore.setState({ currentTrack: own, queue: [own, foreign] });

    renderSync(swc());
    await tick(10_000);

    expect(vi.mocked(savePlayQueue).mock.calls[0]![3]).toEqual(["t1"]);
  });

  it("passes the server's alt_url through when it has one", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({ currentTrack: track, queue: [track] });

    renderSync(swc({ ...SRV, alt_url: "https://alt.example" }));
    await tick(10_000);

    expect(vi.mocked(savePlayQueue).mock.calls[0]![6]).toBe("https://alt.example");
  });
});

describe("useQueueSync immediate save on visibility change / unload", () => {
  it("saves immediately when the tab becomes hidden, without waiting for the debounce", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({ currentTrack: track, queue: [track], elapsed: 5 });

    renderSync(swc());
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(savePlayQueue).toHaveBeenCalledTimes(1);
  });

  it("does nothing when visibility changes to visible", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({ currentTrack: track, queue: [track] });

    renderSync(swc());
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(savePlayQueue).not.toHaveBeenCalled();
  });

  it("saves immediately on beforeunload", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({ currentTrack: track, queue: [track] });

    renderSync(swc());
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    expect(savePlayQueue).toHaveBeenCalledTimes(1);
  });

  it("does nothing on an immediate save when there is no current track", async () => {
    usePlayerStore.setState({ currentTrack: null, queue: [] });

    renderSync(swc());
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    expect(savePlayQueue).not.toHaveBeenCalled();
  });

  it("removes its listeners on unmount", async () => {
    const track = makeTrack("srv-a:t1");
    usePlayerStore.setState({ currentTrack: track, queue: [track] });

    const { unmount } = renderSync(swc());
    unmount();

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    expect(savePlayQueue).not.toHaveBeenCalled();
  });
});
