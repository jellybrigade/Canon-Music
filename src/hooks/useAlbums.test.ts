// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { onInvoke, resetTauriMocks, invoke } from "../test/mocks/tauri";
import { useAlbums } from "./useAlbums";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import type { AlbumRow } from "../types/library";

function album(id: string, serverId: string): AlbumRow {
  return { id, server_id: serverId, name: id, artist: null, year: null, artwork_url: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
  useAlbumBrowseSessionStore.setState({ refreshTick: 0, cachedTick: -1, entries: new Map() });
});

// No `globals: true` in vitest.config.ts, so RTL's auto-cleanup is not registered: without
// this, hooks mounted by an earlier test stay subscribed to the (module-singleton) session
// store and refetch when a later test bumps its tick, inflating that test's invoke count.
afterEach(() => {
  cleanup();
});

describe("useAlbums", () => {
  it("skips the fetch and keeps stale data when disabled", async () => {
    onInvoke("get_albums", () => [album("a1", "s1")]);
    const { result, rerender } = renderHook(({ enabled }) => useAlbums("artist", [], enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.data).toEqual([album("a1", "s1")]));

    rerender({ enabled: false });
    expect(result.current.data).toEqual([album("a1", "s1")]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("serves a cache hit for the same (sort, ids, tick) without a second invoke", async () => {
    const handler = vi.fn().mockResolvedValue([album("a1", "s1")]);
    onInvoke("get_albums", handler);
    const { result, unmount } = renderHook(() => useAlbums("artist", []));
    await waitFor(() => expect(result.current.data).toEqual([album("a1", "s1")]));
    unmount();

    const { result: second } = renderHook(() => useAlbums("artist", []));
    expect(second.current.data).toEqual([album("a1", "s1")]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("seeds data synchronously from the store cache on mount, before any effect runs", () => {
    useAlbumBrowseSessionStore.getState().setRows([album("a1", "s1")], 0, "artist|");
    onInvoke("get_albums", () => new Promise(() => {}));
    const { result } = renderHook(() => useAlbums("artist", []));
    expect(result.current.data).toEqual([album("a1", "s1")]);
    expect(result.current.isLoading).toBe(false);
  });

  it("evicts the oldest cache key once more than 8 distinct keys exist for one tick", () => {
    const store = useAlbumBrowseSessionStore.getState();
    for (let i = 0; i < 8; i++) {
      store.setRows([album(`a${i}`, "s1")], 0, `key${i}`);
    }
    expect(useAlbumBrowseSessionStore.getState().getRows("key0", 0)).toBeDefined();
    store.setRows([album("a8", "s1")], 0, "key8");
    expect(useAlbumBrowseSessionStore.getState().getRows("key0", 0)).toBeUndefined();
    expect(useAlbumBrowseSessionStore.getState().getRows("key8", 0)).toBeDefined();
  });

  it("drops every cached key when a write lands under a new tick", () => {
    const store = useAlbumBrowseSessionStore.getState();
    store.setRows([album("a1", "s1")], 0, "keyA");
    store.setRows([album("a2", "s1")], 1, "keyB");
    expect(useAlbumBrowseSessionStore.getState().getRows("keyA", 1)).toBeUndefined();
    expect(useAlbumBrowseSessionStore.getState().getRows("keyB", 1)).toBeDefined();
  });

  it("sets error and does not poison the cache on a failed read, so a retry re-invokes", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("read failed"));
    onInvoke("get_albums", handler);
    const { result } = renderHook(() => useAlbums("artist", []));
    await waitFor(() => expect(result.current.error).toBe("read failed"));
    expect(result.current.data).toBeUndefined();

    act(() => useAlbumBrowseSessionStore.getState().bumpRefresh());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });

  it("reports each row's own server_id, never a value reconstructed from a single active server", async () => {
    onInvoke("get_albums", () => [album("a1", "s1"), album("a2", "s2")]);
    const { result } = renderHook(() => useAlbums("artist", []));
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.map((a) => a.server_id)).toEqual(["s1", "s2"]);
  });
});
