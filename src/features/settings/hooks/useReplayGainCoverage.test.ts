// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { useReplayGainCoverage } from "./useReplayGainCoverage";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function seedTrack(
  id: string,
  serverId: string,
  gains: { track?: number | null; album?: number | null } = {}
) {
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, replay_gain_track_gain, replay_gain_album_gain)
       VALUES (?, ?, 'navidrome', ?, ?, ?)`
    )
    .run(id, serverId, `title ${id}`, gains.track ?? null, gains.album ?? null);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("useReplayGainCoverage", () => {
  it("counts each gain column separately and the union of the two", async () => {
    seedTrack("t1", "srv-a", { track: -7.2, album: -6.9 });
    seedTrack("t2", "srv-a", { track: -4.0 });
    seedTrack("t3", "srv-a", { album: -5.5 });
    seedTrack("t4", "srv-a");
    const { result } = renderHook(() => useReplayGainCoverage("srv-a"), { wrapper });
    await waitFor(() => expect(result.current.coverage).toBeDefined());
    expect(result.current.coverage).toEqual({
      total: 4,
      withTrackGain: 2,
      withAlbumGain: 2,
      withAnyGain: 3,
    });
  });

  it("counts only the server asked about", async () => {
    seedTrack("t1", "srv-a", { track: -7.2 });
    seedTrack("t2", "srv-b", { track: -7.2 });
    seedTrack("t3", "srv-b");
    const { result } = renderHook(() => useReplayGainCoverage("srv-a"), { wrapper });
    await waitFor(() => expect(result.current.coverage).toBeDefined());
    expect(result.current.coverage).toEqual({
      total: 1,
      withTrackGain: 1,
      withAlbumGain: 0,
      withAnyGain: 1,
    });
  });

  it("reports an empty mirror as zero rather than as pending forever", async () => {
    const { result } = renderHook(() => useReplayGainCoverage("srv-a"), { wrapper });
    await waitFor(() => expect(result.current.coverage).toBeDefined());
    expect(result.current.coverage?.total).toBe(0);
    expect(result.current.isPending).toBe(false);
  });

  it("stays pending, with no read, while no server is selected", async () => {
    const { result } = renderHook(() => useReplayGainCoverage(undefined), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.coverage).toBeUndefined();
    expect(db.selectCount).toBe(0);
  });

  it("reads the library once per mount, in one pass", async () => {
    seedTrack("t1", "srv-a", { track: -7.2 });
    const { result, rerender } = renderHook(() => useReplayGainCoverage("srv-a"), { wrapper });
    await waitFor(() => expect(result.current.coverage).toBeDefined());
    rerender();
    rerender();
    expect(db.selectCount).toBe(1);
    expect(db.queryLog.filter((q) => q.kind === "select")).toHaveLength(1);
  });

  it("does not re-read for a second consumer of the same server", async () => {
    seedTrack("t1", "srv-a", { album: -7.2 });
    const first = renderHook(() => useReplayGainCoverage("srv-a"), { wrapper });
    await waitFor(() => expect(first.result.current.coverage).toBeDefined());
    const second = renderHook(() => useReplayGainCoverage("srv-a"), { wrapper });
    await waitFor(() => expect(second.result.current.coverage).toBeDefined());
    expect(db.selectCount).toBe(1);
  });
});
