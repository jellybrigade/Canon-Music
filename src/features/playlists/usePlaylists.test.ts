// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../clients/navidromePlaylists", async () => {
  const actual = await vi.importActual<typeof import("../../clients/navidromePlaylists")>(
    "../../clients/navidromePlaylists",
  );
  return { ...actual, addTrackToNavidromePlaylist: vi.fn(), addTracksToNavidromePlaylist: vi.fn() };
});

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { usePlaylistSessionStore } from "../../store/playlistSessionStore";
import { invoke, onInvoke, resetTauriMocks } from "../../test/mocks/tauri";
import { createMigratedTestDb } from "../../test/sqlite";
import { type PlaylistRow, usePlaylists } from "./usePlaylists";

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

describe("adding to a playlist", () => {
  const swc: ServerWithCredential = {
    server: {
      id: "s1",
      type: "navidrome",
      url: "https://music.example",
      alt_url: null,
      display_name: "Home",
      username: "marcel",
      created_at: "2026-01-01T00:00:00Z",
    },
    credential: { type: "md5", token: "tok", salt: "salt" },
  };

  beforeEach(async () => {
    onInvoke("get_playlists", () => []);
    onInvoke("playlist_append_tracks", () => undefined);
    const db = await createMigratedTestDb();
    db.raw.exec(`INSERT INTO playlists (id, server_id, name, track_count) VALUES ('s1:p', 's1', 'p', 0);
      INSERT INTO tracks (id, server_id, server_type, title, album_id, disc_number, track_number) VALUES
        ('s1:t2', 's1', 'navidrome', 'Two', 's1:a', 1, 2), ('s1:t1', 's1', 'navidrome', 'One', 's1:a', 1, 1);`);
    vi.mocked(getDb).mockResolvedValue(db as never);
  });

  // Reading the end of the list and writing after it took separate statements, so two adds in
  // flight claimed one position and the second track was dropped while the count still rose.
  it("appends a track in one write that finds the end of the list itself", async () => {
    const { result } = renderHook(() => usePlaylists());
    await act(() => result.current.addTrackToPlaylist(playlist("s1:p"), "s1:t1", swc));
    expect(invoke).toHaveBeenCalledWith("playlist_append_tracks", { playlistId: "s1:p", trackIds: ["s1:t1"] });
  });

  it("appends an album's tracks in disc and track order in one write", async () => {
    const { result } = renderHook(() => usePlaylists());
    await act(() => result.current.addAlbumToPlaylist(playlist("s1:p"), "s1:a", swc));
    expect(invoke).toHaveBeenCalledWith("playlist_append_tracks", {
      playlistId: "s1:p",
      trackIds: ["s1:t1", "s1:t2"],
    });
  });
});
