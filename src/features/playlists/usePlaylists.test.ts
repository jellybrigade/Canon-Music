// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { onInvoke, resetTauriMocks, invoke } from "../../test/mocks/tauri";
import { usePlaylists, type PlaylistRow } from "./usePlaylists";
import { usePlaylistSessionStore } from "../../store/playlistSessionStore";

function playlist(id: string): PlaylistRow {
  return {
    id,
    server_id: "s1",
    name: id,
    comment: null,
    track_count: 0,
    cover_art_url: null,
    custom_cover_data: null,
    is_smart: 0,
    rules_json: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
  usePlaylistSessionStore.setState({ playlistsTick: 0, rows: undefined, cachedTick: -1 });
});

afterEach(() => {
  cleanup();
});

describe("usePlaylists", () => {
  it("reports loading until the first read lands", async () => {
    onInvoke("get_playlists", () => [playlist("p1")]);
    const { result } = renderHook(() => usePlaylists());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([playlist("p1")]);
  });

  it("keeps isLoading false while a refresh tick refetches rows already shown", async () => {
    onInvoke("get_playlists", () => [playlist("p1")]);
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const r = usePlaylists();
      seen.push(r.isLoading);
      return r;
    });
    await waitFor(() => expect(result.current.data).toEqual([playlist("p1")]));

    onInvoke("get_playlists", () => new Promise(() => {}));
    seen.length = 0;
    act(() => usePlaylistSessionStore.setState({ playlistsTick: 1 }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(seen).not.toContain(true);
    expect(result.current.data).toEqual([playlist("p1")]);
  });
});
