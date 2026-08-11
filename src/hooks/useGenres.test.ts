// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { onInvoke, resetTauriMocks, invoke } from "../test/mocks/tauri";
import { useGenres, useRecentGenres, type GenreRow } from "./useGenres";
import { useGenresSessionStore } from "../store/genresSessionStore";

function genre(id: string): GenreRow {
  return { canonical_id: id, name: id, album_count: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
  useGenresSessionStore.setState({
    refreshTick: 0,
    rows: undefined,
    cachedTick: -1,
    recentRows: undefined,
    recentCachedTick: -1,
  });
});

// No `globals: true` in vitest.config.ts, so RTL's auto-cleanup is not registered: without
// this, hooks mounted by an earlier test stay subscribed to the (module-singleton) session
// store and refetch when a later test bumps its tick, inflating that test's invoke count.
afterEach(() => {
  cleanup();
});

describe("useGenres", () => {
  it("has no error state - a failed read just leaves data undefined and stops loading", async () => {
    onInvoke("get_genres", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useGenres());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect("error" in result.current).toBe(false);
  });

  it("serves a cache hit for the same tick without a second invoke", async () => {
    const handler = vi.fn().mockResolvedValue([genre("rock")]);
    onInvoke("get_genres", handler);
    const { unmount } = renderHook(() => useGenres());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    unmount();

    const { result } = renderHook(() => useGenres());
    expect(result.current.data).toEqual([genre("rock")]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips the fetch and keeps stale data when disabled", async () => {
    onInvoke("get_genres", () => [genre("rock")]);
    const { result, rerender } = renderHook(({ enabled }) => useGenres(enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.data).toEqual([genre("rock")]));

    rerender({ enabled: false });
    expect(result.current.data).toEqual([genre("rock")]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("useRecentGenres", () => {
  it("always fetches on mount - there is no enabled gate", async () => {
    const handler = vi.fn().mockResolvedValue([genre("jazz")]);
    onInvoke("get_recent_genres", handler);
    renderHook(() => useRecentGenres());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });

  it("exposes genres as [] while loading, distinct from data which stays undefined", () => {
    onInvoke("get_recent_genres", () => new Promise(() => {}));
    const { result } = renderHook(() => useRecentGenres());
    expect(result.current.data).toBeUndefined();
    expect(result.current.genres).toEqual([]);
  });

  it("exposes genres as the resolved rows once loaded", async () => {
    onInvoke("get_recent_genres", () => [genre("jazz")]);
    const { result } = renderHook(() => useRecentGenres());
    await waitFor(() => expect(result.current.data).toEqual([genre("jazz")]));
    expect(result.current.genres).toEqual([genre("jazz")]);
  });

  it("shares one refreshTick with useGenres - one bump invalidates both caches", async () => {
    const genresHandler = vi.fn().mockResolvedValue([genre("rock")]);
    const recentHandler = vi.fn().mockResolvedValue([genre("jazz")]);
    onInvoke("get_genres", genresHandler);
    onInvoke("get_recent_genres", recentHandler);

    const genresHook = renderHook(() => useGenres());
    const recentHook = renderHook(() => useRecentGenres());
    await waitFor(() => expect(genresHandler).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(recentHandler).toHaveBeenCalledTimes(1));

    act(() => useGenresSessionStore.getState().bumpRefresh());
    await waitFor(() => expect(genresHandler).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(recentHandler).toHaveBeenCalledTimes(2));
    void genresHook;
    void recentHook;
  });
});
