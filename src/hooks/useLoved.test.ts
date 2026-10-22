// @vitest-environment jsdom
/**
 * Baseline coverage for `src/hooks/useLoved.ts`'s read path, plus the harness regression it
 * exposed: `get_loved` had no default handler in the shared Tauri mock, so every suite that
 * mounted the hook without registering one ran the load through its `catch` and asserted
 * against sets that were empty because the read had failed. The success path is the default
 * here; the failure shape is asserted deliberately instead of incidentally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../clients/navidrome", () => ({
  starTrack: vi.fn(),
  unstarTrack: vi.fn(),
  starAlbum: vi.fn(),
  unstarAlbum: vi.fn(),
}));

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { starAlbum, starTrack, unstarTrack } from "../clients/navidrome";
import { getDb } from "../db";
import { useLovedSessionStore } from "../store/lovedSessionStore";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { CRED, SRV, server } from "../test/navidromeFixtures";
import { invokeCount } from "../test/perf";
import { createMigratedTestDb } from "../test/sqlite";
import { useLoved } from "./useLoved";

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

beforeEach(async () => {
  resetTauriMocks();
  vi.clearAllMocks();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(starTrack).mockResolvedValue();
  vi.mocked(unstarTrack).mockResolvedValue();
  vi.mocked(starAlbum).mockResolvedValue();
  useLovedSessionStore.setState({ refreshTick: 0, sets: undefined, cachedTick: -1 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLoved read path", () => {
  it("loads an empty result without an error when no test registers get_loved", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useLoved());

    await waitFor(() => expect(useLovedSessionStore.getState().sets).toBeDefined());
    expect(result.current.lovedTrackIds.size).toBe(0);
    expect(useLovedSessionStore.getState().cachedTick).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it("puts the ids the command returns into the session sets", async () => {
    onInvoke("get_loved", () => ({
      trackIds: ["srv-a:t1", "srv-a:t2"],
      albumIds: ["srv-a:al1"],
      trackAlbumIds: ["srv-a:al2"],
    }));
    const { result } = renderHook(() => useLoved());

    await waitFor(() => expect(result.current.lovedTrackIds.size).toBe(2));
    expect(result.current.lovedTrackIds.has("srv-a:t1")).toBe(true);
    expect(result.current.lovedAlbumIds.has("srv-a:al1")).toBe(true);
    expect(result.current.lovedTrackAlbumIds.has("srv-a:al2")).toBe(true);
  });

  it("keeps the sets unset and reports the failure when the read throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    onInvoke("get_loved", () => {
      throw new Error("no such command");
    });
    const { result } = renderHook(() => useLoved());

    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(errors.mock.calls[0]?.[0]).toBe("useLoved: failed to load loved ids");
    expect(useLovedSessionStore.getState().sets).toBeUndefined();
    expect(result.current.lovedTrackIds.size).toBe(0);
  });

  it("reads once for many mounts on the same tick", async () => {
    onInvoke("get_loved", () => ({ trackIds: ["srv-a:t1"], albumIds: [], trackAlbumIds: [] }));
    const mounts = Array.from({ length: 8 }, () => renderHook(() => useLoved()));

    const last = mounts[mounts.length - 1]!;
    await waitFor(() => expect(last.result.current.lovedTrackIds.size).toBe(1));
    expect(invokeCount("get_loved")).toBe(1);
  });
});

describe("useLoved toggles", () => {
  const serverWithCred = { server: server(), credential: CRED };
  const trackId = `${SRV}:t1`;

  it("takes the love back when the server refuses it, so the heart doesn't flip on the next sync", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(starTrack).mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useLoved());

    await act(() => result.current.toggleTrackLove(trackId, serverWithCred));

    expect(await db.select("SELECT track_id FROM loved_tracks")).toEqual([]);
  });

  it("takes an album love back when the server refuses it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(starAlbum).mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useLoved());

    await act(() => result.current.toggleAlbumLove(`${SRV}:al1`, serverWithCred));

    expect(await db.select("SELECT album_id FROM loved_albums")).toEqual([]);
  });

  it("keeps the love once the server accepts it", async () => {
    const { result } = renderHook(() => useLoved());

    await act(() => result.current.toggleTrackLove(trackId, serverWithCred));

    expect(await db.select("SELECT track_id FROM loved_tracks")).toEqual([{ track_id: trackId }]);
    expect(starTrack).toHaveBeenCalledTimes(1);
  });

  it("sends an unlove only after the love before it landed, so the server ends where the heart does", async () => {
    let releaseStar = () => {};
    vi.mocked(starTrack).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStar = resolve;
        }),
    );
    const { result } = renderHook(() => useLoved());

    const love = result.current.toggleTrackLove(trackId, serverWithCred);
    const unlove = result.current.toggleTrackLove(trackId, serverWithCred);
    await waitFor(() => expect(starTrack).toHaveBeenCalledTimes(1));
    expect(unstarTrack).not.toHaveBeenCalled();

    releaseStar();
    await act(() => Promise.all([love, unlove]));

    expect(unstarTrack).toHaveBeenCalledTimes(1);
    expect(await db.select("SELECT track_id FROM loved_tracks")).toEqual([]);
  });
});
