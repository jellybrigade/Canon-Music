// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useGenresSessionStore } from "../store/genresSessionStore";
import { invoke, onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { type GenreRow, useGenres, useRecentGenres } from "./useGenres";

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
  it("reports a failed read as an error, not as an empty genre list", async () => {
    onInvoke("get_genres", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useGenres());
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("clears the error once a refresh reads successfully", async () => {
    onInvoke("get_genres", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useGenres());
    await waitFor(() => expect(result.current.error).toBe("db locked"));

    onInvoke("get_genres", () => [genre("rock")]);
    act(() => useGenresSessionStore.getState().bumpRefresh());
    await waitFor(() => expect(result.current.data).toEqual([genre("rock")]));
    expect(result.current.error).toBeNull();
  });

  it("retries only its own read, leaving recent genres alone", async () => {
    onInvoke("get_genres", () => {
      throw new Error("db locked");
    });
    const recentHandler = vi.fn().mockResolvedValue([genre("jazz")]);
    onInvoke("get_recent_genres", recentHandler);
    const { result } = renderHook(() => ({ library: useGenres(), recent: useRecentGenres() }));
    await waitFor(() => expect(result.current.library.error).toBe("db locked"));
    await waitFor(() => expect(recentHandler).toHaveBeenCalledTimes(1));

    onInvoke("get_genres", () => [genre("rock")]);
    act(() => result.current.library.retry());
    await waitFor(() => expect(result.current.library.data).toEqual([genre("rock")]));
    expect(result.current.library.error).toBeNull();
    expect(recentHandler).toHaveBeenCalledTimes(1);
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

  it("keeps isLoading false while a refresh tick refetches rows already shown", async () => {
    onInvoke("get_genres", () => [genre("g1")]);
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const r = useGenres();
      seen.push(r.isLoading);
      return r;
    });
    await waitFor(() => expect(result.current.data).toEqual([genre("g1")]));

    onInvoke("get_genres", () => new Promise(() => {}));
    seen.length = 0;
    act(() => useGenresSessionStore.setState({ refreshTick: 1 }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(seen).not.toContain(true);
    expect(result.current.data).toEqual([genre("g1")]);
  });
});

describe("useRecentGenres", () => {
  it("reports a failed read as an error, not as an empty genre list", async () => {
    onInvoke("get_recent_genres", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useRecentGenres());
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("retries a failed read", async () => {
    onInvoke("get_recent_genres", () => {
      throw new Error("db locked");
    });
    const { result } = renderHook(() => useRecentGenres());
    await waitFor(() => expect(result.current.error).toBe("db locked"));

    onInvoke("get_recent_genres", () => [genre("jazz")]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.genres).toEqual([genre("jazz")]));
    expect(result.current.error).toBeNull();
  });

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

  it("keeps isLoading false while a refresh tick refetches rows already shown", async () => {
    onInvoke("get_recent_genres", () => [genre("g1")]);
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const r = useRecentGenres();
      seen.push(r.isLoading);
      return r;
    });
    await waitFor(() => expect(result.current.data).toEqual([genre("g1")]));

    onInvoke("get_recent_genres", () => new Promise(() => {}));
    seen.length = 0;
    act(() => useGenresSessionStore.setState({ refreshTick: 1 }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(seen).not.toContain(true);
    expect(result.current.data).toEqual([genre("g1")]);
  });
});
