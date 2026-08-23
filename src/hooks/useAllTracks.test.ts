// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { onInvoke, resetTauriMocks, invoke } from "../test/mocks/tauri";
import { useAllTracks, type AllTrackRow } from "./useAllTracks";
import { useAllTracksSessionStore } from "../store/allTracksSessionStore";

function row(id: string): AllTrackRow {
  return {
    id,
    title: id,
    artist: null,
    album_artist: null,
    album_id: "a1",
    album_name: null,
    album_artwork_url: null,
    genre: null,
    track_number: null,
    disc_number: null,
    year: null,
    duration: null,
    play_count: null,
    bit_rate: null,
    suffix: null,
    replay_gain_track_gain: null,
    replay_gain_track_peak: null,
    replay_gain_album_gain: null,
    replay_gain_album_peak: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
  useAllTracksSessionStore.setState({
    refreshTick: 0,
    rows: undefined,
    cachedTick: -1,
    cachedKey: undefined,
  });
});

// No `globals: true` in vitest.config.ts, so RTL's auto-cleanup is not registered: without
// this, hooks mounted by an earlier test stay subscribed to the (module-singleton) session
// store and refetch when a later test bumps its tick, inflating that test's invoke count.
afterEach(() => {
  cleanup();
});

describe("useAllTracks", () => {
  it("skips the fetch and keeps stale data when disabled", async () => {
    onInvoke("get_all_tracks", () => [row("t1")]);
    const { result, rerender } = renderHook(({ enabled }) => useAllTracks(enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.data).toEqual([row("t1")]));

    rerender({ enabled: false });
    expect(result.current.data).toEqual([row("t1")]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("serves a cache hit for the same tick without a second invoke", async () => {
    const handler = vi.fn().mockResolvedValue([row("t1")]);
    onInvoke("get_all_tracks", handler);
    const { unmount } = renderHook(() => useAllTracks());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    unmount();

    const { result } = renderHook(() => useAllTracks());
    expect(result.current.data).toEqual([row("t1")]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refetches once the session tick bumps", async () => {
    const handler = vi.fn().mockResolvedValue([row("t1")]);
    onInvoke("get_all_tracks", handler);
    const { result } = renderHook(() => useAllTracks());
    await waitFor(() => expect(result.current.data).toEqual([row("t1")]));

    act(() => useAllTracksSessionStore.getState().bumpRefresh());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });

  it("sets error and leaves data undefined on a failed read", async () => {
    onInvoke("get_all_tracks", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useAllTracks());
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.data).toBeUndefined();
  });
});
