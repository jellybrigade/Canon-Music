// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { onInvoke, resetTauriMocks, invoke } from "../test/mocks/tauri";
import { useArtists } from "./useArtists";
import { useArtistBrowseSessionStore } from "../store/artistBrowseSessionStore";
import type { ArtistRow } from "../types/library";

function artist(name: string): ArtistRow {
  return { name, album_count: 1 } as ArtistRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
  useArtistBrowseSessionStore.setState({
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
  vi.useRealTimers();
});

describe("useArtists", () => {
  it("skips the fetch and keeps stale data when disabled", async () => {
    onInvoke("get_artists", () => [artist("A")]);
    const { result, rerender } = renderHook(({ enabled }) => useArtists(enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.data).toEqual([artist("A")]));

    rerender({ enabled: false });
    expect(result.current.data).toEqual([artist("A")]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("serves a cache hit for the same tick without a second invoke", async () => {
    const handler = vi.fn().mockResolvedValue([artist("A")]);
    onInvoke("get_artists", handler);
    const { unmount } = renderHook(() => useArtists());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    unmount();

    const { result } = renderHook(() => useArtists());
    expect(result.current.data).toEqual([artist("A")]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of bumpRefresh calls within 400ms into a single tick increment", () => {
    vi.useFakeTimers();
    const store = useArtistBrowseSessionStore.getState();
    store.bumpRefresh();
    vi.advanceTimersByTime(100);
    store.bumpRefresh();
    vi.advanceTimersByTime(100);
    store.bumpRefresh();
    vi.advanceTimersByTime(400);
    expect(useArtistBrowseSessionStore.getState().refreshTick).toBe(1);
  });

  it("caches fetched rows on the store keyed by tick", async () => {
    onInvoke("get_artists", () => [artist("A")]);
    const { result } = renderHook(() => useArtists());
    await waitFor(() => expect(result.current.data).toEqual([artist("A")]));
    expect(useArtistBrowseSessionStore.getState().rows).toEqual([artist("A")]);
    expect(useArtistBrowseSessionStore.getState().cachedTick).toBe(0);
  });

  it("sets error and leaves data undefined on a failed read", async () => {
    onInvoke("get_artists", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useArtists());
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.data).toBeUndefined();
  });
});
