// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useLyrics.ts` - the lyrics lookup and its local cache.
 *
 * The lookup costs three network round trips (OpenSubsonic, LRClib, lyrics.ovh) and most of
 * a library has lyrics for none of it, so the row written when every source comes back empty
 * is the one that matters most. `refresh` clears the lyrics columns without dropping the row
 * (`offset_ms` is the user's own work), which is why "no lyrics stored" cannot be the test for
 * "never looked up". Both `source` and `fetched_at` are NOT NULL, so a sentinel `source` is.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/lrclib", () => ({ fetchLyrics: vi.fn() }));
vi.mock("../lib/lyrics-ovh", () => ({ fetchLyricsOvh: vi.fn() }));
vi.mock("../lib/navidrome", () => ({
  fetchLyricsBySongId: vi.fn(),
  getStoredOpenSubsonicExtensions: vi.fn(),
}));

import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchLyrics } from "../lib/lrclib";
import { fetchLyricsOvh } from "../lib/lyrics-ovh";
import { getStoredOpenSubsonicExtensions } from "../lib/navidrome";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import type { CurrentTrack } from "../store/player";
import { useLyrics } from "./useLyrics";

const TRACK: CurrentTrack = {
  id: "srv-a:t1",
  title: "Only Shallow",
  artist: "my bloody valentine",
  album: "Loveless",
  duration: 249,
};

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function lyricsRow(): { plain: string | null; synced: string | null; source: string } | undefined {
  return db.raw
    .prepare("SELECT plain, synced, source FROM lyrics WHERE track_id = ?")
    .get(TRACK.id) as { plain: string | null; synced: string | null; source: string } | undefined;
}

/** Mounts the hook and waits for the query to settle. */
async function mountSettled() {
  const view = renderHook(() => useLyrics(TRACK, null, null), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(getStoredOpenSubsonicExtensions).mockResolvedValue([]);
  vi.mocked(fetchLyrics).mockResolvedValue(null);
  vi.mocked(fetchLyricsOvh).mockResolvedValue(null);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useLyrics", () => {
  it("looks a track with no lyrics up once, however often the tab is reopened", async () => {
    const first = await mountSettled();
    expect(first.result.current.plain).toBeNull();
    expect(lyricsRow()?.source).toBe("lrclib");
    first.unmount();

    // A fresh client is the honest stand-in for reopening the app: React Query's own cache
    // would answer the second mount without ever reaching the queryFn, so it would pass
    // whether or not the SQLite row is a cache hit.
    queryClient.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const second = await mountSettled();
    expect(second.result.current.plain).toBeNull();

    expect(vi.mocked(fetchLyrics)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchLyricsOvh)).toHaveBeenCalledTimes(1);
  });

  it("looks the track up again after a refresh cleared the stored lyrics", async () => {
    vi.mocked(fetchLyrics).mockResolvedValue({ plain: "loveless", synced: null });
    const view = await mountSettled();
    expect(view.result.current.plain).toBe("loveless");

    await act(async () => { await view.result.current.refresh(); });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    // The refresh is a deliberate "go and ask again", so the row it leaves behind must not
    // read as a completed lookup - the offset it preserves is the only reason it survives.
    expect(vi.mocked(fetchLyrics)).toHaveBeenCalledTimes(2);
    expect(view.result.current.plain).toBe("loveless");
  });

  it("does not turn a saved timing offset into a completed lookup", async () => {
    const view = renderHook(() => useLyrics(TRACK, null, null), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => { await view.result.current.setOffsetMs(400); });
    expect(lyricsRow()?.plain).toBeNull();

    db.raw.prepare("DELETE FROM lyrics WHERE track_id = ?").run(TRACK.id);
    db.raw
      .prepare("INSERT INTO lyrics (track_id, plain, synced, source, fetched_at, offset_ms) VALUES (?, NULL, NULL, 'cleared', datetime('now'), 400)")
      .run(TRACK.id);

    queryClient.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(fetchLyrics).mockResolvedValue({ plain: "loveless", synced: null });
    const second = await mountSettled();
    expect(second.result.current.plain).toBe("loveless");
  });
});
