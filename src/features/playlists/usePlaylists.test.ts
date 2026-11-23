// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../clients/navidromePlaylists", async () => {
  const actual = await vi.importActual<typeof import("../../clients/navidromePlaylists")>(
    "../../clients/navidromePlaylists",
  );
  return {
    ...actual,
    addTrackToNavidromePlaylist: vi.fn(),
    addTracksToNavidromePlaylist: vi.fn(),
    createNavidromePlaylist: vi.fn(),
    deleteNavidromePlaylist: vi.fn(),
  };
});

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { addTracksToNavidromePlaylist, createNavidromePlaylist } from "../../clients/navidromePlaylists";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { useDismissibleNoticeStore } from "../../store/dismissibleNotice";
import { usePlaylistSessionStore } from "../../store/playlistSessionStore";
import { invoke, onInvoke, resetTauriMocks } from "../../test/mocks/tauri";
import { createMigratedTestDb } from "../../test/sqlite";
import { DEFAULT_SMART_FILTERS } from "./smartPlaylist";
import { createPlaylist, type PlaylistRow, usePlaylists } from "./usePlaylists";

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
  useDismissibleNoticeStore.setState({ notice: null });
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

  // A failed read left the list undefined, which the page shows as loading, so it loaded forever.
  it("reports a failed read and reads again on retry", async () => {
    onInvoke("get_playlists", () => Promise.reject(new Error("database is locked")));
    const { result } = renderHook(() => usePlaylists());
    await waitFor(() => expect(result.current.error).toBe("database is locked"));
    expect(result.current.isLoading).toBe(false);

    onInvoke("get_playlists", () => [playlist("p1")]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toEqual([playlist("p1")]));
    expect(result.current.error).toBeNull();
  });

  it("shows loading, not the old error, while a retry reads again", async () => {
    onInvoke("get_playlists", () => Promise.reject(new Error("database is locked")));
    const { result } = renderHook(() => usePlaylists());
    await waitFor(() => expect(result.current.error).toBe("database is locked"));

    onInvoke("get_playlists", () => new Promise(() => {}));
    act(() => result.current.retry());

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("says so when a refresh fails with playlists already on screen", async () => {
    onInvoke("get_playlists", () => [playlist("p1")]);
    const { result } = renderHook(() => usePlaylists());
    await waitFor(() => expect(result.current.data).toEqual([playlist("p1")]));

    onInvoke("get_playlists", () => Promise.reject(new Error("database is locked")));
    act(() => usePlaylistSessionStore.getState().bumpPlaylists());

    await waitFor(() =>
      expect(useDismissibleNoticeStore.getState().notice).toEqual({
        message: "Couldn't refresh your playlists: database is locked",
      }),
    );
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

  it("creates a playlist with its tracks in one request and stores them in that order", async () => {
    vi.mocked(createNavidromePlaylist).mockResolvedValue({ id: "q", name: "Queue", songCount: 2 } as never);
    await createPlaylist("Queue", swc, ["s1:t2", "s1:t1"]);

    expect(createNavidromePlaylist).toHaveBeenCalledTimes(1);
    expect(createNavidromePlaylist).toHaveBeenCalledWith(
      "https://music.example",
      "marcel",
      swc.credential,
      "Queue",
      ["t2", "t1"],
      undefined,
    );
    const db = await getDb();
    const rows = await db.select<{ track_id: string }[]>(
      "SELECT track_id FROM playlist_tracks WHERE playlist_id = 's1:q' ORDER BY position",
    );
    expect(rows.map((r) => r.track_id)).toEqual(["s1:t2", "s1:t1"]);
  });

  // Created empty, then filled by a second request: a refused fill left an empty playlist on the
  // server that the next sync brought in as a plain one, and saving again made a second.
  it("creates a smart playlist with its tracks in the one creating request", async () => {
    vi.mocked(createNavidromePlaylist).mockResolvedValue({ id: "sm", name: "All", songCount: 2 } as never);
    const { result } = renderHook(() => usePlaylists());
    await act(() => result.current.createSmartPlaylist({ ...DEFAULT_SMART_FILTERS, name: "All", sort: "+title" }, swc));

    expect(createNavidromePlaylist).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNavidromePlaylist).mock.calls[0]?.[4]).toEqual(["t1", "t2"]);
    expect(addTracksToNavidromePlaylist).not.toHaveBeenCalled();
  });
});

describe("deleting a playlist", () => {
  // The resume row outlived its playlist: sync prunes only playlists it still has locally.
  it("removes its resume point with it", async () => {
    onInvoke("get_playlists", () => []);
    const db = await createMigratedTestDb();
    db.raw.exec(`INSERT INTO playlists (id, server_id, name, track_count) VALUES ('s1:p', 's1', 'p', 0);
      INSERT INTO playlist_resume (playlist_id, last_track_id, track_position) VALUES ('s1:p', 's1:t1', 0);`);
    vi.mocked(getDb).mockResolvedValue(db as never);
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
    const { result } = renderHook(() => usePlaylists());
    await act(() => result.current.deletePlaylist(playlist("s1:p"), swc));
    expect(await db.select("SELECT playlist_id FROM playlist_resume")).toEqual([]);
  });
});
