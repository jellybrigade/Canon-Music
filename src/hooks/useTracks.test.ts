// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { onInvoke, resetTauriMocks, invoke } from "../test/mocks/tauri";
import { useTracks } from "./useTracks";
import { useTrackListSessionStore } from "../store/trackListSessionStore";
import type { TrackRow } from "../types/library";

function track(id: string, albumId: string): TrackRow {
  return {
    id,
    album_id: albumId,
    title: id,
    artist: null,
    track_number: 1,
    disc_number: 1,
    duration: 100,
  } as TrackRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
  useTrackListSessionStore.setState({ refreshTick: 0 });
});

// No `globals: true` in vitest.config.ts, so RTL's auto-cleanup is not registered: without
// this, hooks mounted by an earlier test stay subscribed to the (module-singleton) session
// store and refetch when a later test bumps its tick, inflating that test's invoke count.
afterEach(() => {
  cleanup();
});

describe("useTracks", () => {
  it("clears state and skips invoke when albumId is null", async () => {
    const { result } = renderHook(() => useTracks(null));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clears data immediately when switching albums, before the new fetch resolves", async () => {
    let resolveFirst!: (rows: TrackRow[]) => void;
    onInvoke("get_tracks", () => new Promise((res) => (resolveFirst = res)));
    const { result, rerender } = renderHook(({ albumId }) => useTracks(albumId), {
      initialProps: { albumId: "a1" },
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_tracks", { albumId: "a1" }));
    resolveFirst([track("t1", "a1")]);
    await waitFor(() => expect(result.current.data).toEqual([track("t1", "a1")]));

    onInvoke("get_tracks", () => new Promise(() => {})); // never resolves
    rerender({ albumId: "a2" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it("is loading synchronously on mount when an albumId is provided", () => {
    onInvoke("get_tracks", () => new Promise(() => {}));
    const { result } = renderHook(() => useTracks("a1"));
    expect(result.current.isLoading).toBe(true);
  });

  it("drops a stale response when albumId changes again before the first invoke resolves", async () => {
    let resolveFirst!: (rows: TrackRow[]) => void;
    let callCount = 0;
    onInvoke("get_tracks", (args) => {
      callCount++;
      const { albumId } = args as { albumId: string };
      if (albumId === "a1") return new Promise((res) => (resolveFirst = res));
      return [track("t2", "a2")];
    });
    const { result, rerender } = renderHook(({ albumId }) => useTracks(albumId), {
      initialProps: { albumId: "a1" },
    });
    rerender({ albumId: "a2" });
    await waitFor(() => expect(result.current.data).toEqual([track("t2", "a2")]));

    resolveFirst([track("t1", "a1")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(callCount).toBe(2);
    expect(result.current.data).toEqual([track("t2", "a2")]);
  });

  it("refetches on the same albumId when the session tick bumps, with no cache short-circuit", async () => {
    const handler = vi.fn().mockResolvedValue([track("t1", "a1")]);
    onInvoke("get_tracks", handler);
    const { result } = renderHook(() => useTracks("a1"));
    await waitFor(() => expect(result.current.data).toEqual([track("t1", "a1")]));
    expect(handler).toHaveBeenCalledTimes(1);

    act(() => {
      useTrackListSessionStore.getState().bumpRefresh();
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });

  it("sets error and leaves data undefined on a failed read", async () => {
    onInvoke("get_tracks", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useTracks("a1"));
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});
