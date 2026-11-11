// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { useListeningStats } from "./useListeningStats";
import { useRecentlyReleasedAlbums } from "./useRecentlyReleasedAlbums";
import { useRecommendedAlbum } from "./useRecommendedAlbum";

let db: FakeDatabase;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

afterEach(() => {
  cleanup();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

function seedAlbum(id: string, serverId: string, options: { playCount?: number; year?: number } = {}): void {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, artwork_url, play_count, played_at)
       VALUES (?, ?, 'navidrome', ?, 'Artist', ?, 'art', ?, '2026-11-01T00:00:00Z')`,
    )
    .run(id, serverId, id, options.year ?? null, options.playCount ?? 0);
}

function seedTrack(id: string, albumId: string, serverId: string, playCount: number): void {
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, album_id, disc_number, track_number, play_count)
       VALUES (?, ?, 'navidrome', ?, ?, 1, 1, ?)`,
    )
    .run(id, serverId, id, albumId, playCount);
}

function tagAlbum(albumId: string, canonicalId: string): void {
  db.raw
    .prepare("INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES (?, ?, 'direct', ?)")
    .run(albumId, canonicalId, canonicalId);
}

describe("Home reads show the active server's albums only", () => {
  it("lists played and partly heard albums of that server", async () => {
    seedAlbum("a:mine", "a", { playCount: 3 });
    seedAlbum("b:other", "b", { playCount: 9 });
    seedTrack("a:t1", "a:mine", "a", 1);
    seedTrack("a:t2", "a:mine", "a", 0);
    seedTrack("b:t1", "b:other", "b", 1);
    seedTrack("b:t2", "b:other", "b", 0);

    const { result } = renderHook(() => useListeningStats("a"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stats.map((s) => s.id)).toEqual(["a:mine"]);
    expect(result.current.finishTheAlbum.map((s) => s.id)).toEqual(["a:mine"]);
  });

  it("lists Recently Released from that server, with its cutoff taken from that server's years", async () => {
    seedAlbum("a:old", "a", { year: 2001 });
    seedAlbum("b:new1", "b", { year: 2026 });
    seedAlbum("b:new2", "b", { year: 2025 });

    const { result } = renderHook(() => useRecentlyReleasedAlbums("a", 1), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.map((a) => a.id)).toEqual(["a:old"]);
  });

  it("recommends an album from the playing album's server", async () => {
    seedAlbum("a:playing", "a");
    seedAlbum("b:match", "b");
    seedAlbum("a:match", "a");
    for (const id of ["a:playing", "b:match", "a:match"]) tagAlbum(id, "shoegaze");

    for (let i = 0; i < 10; i++) {
      const { result, unmount } = renderHook(() => useRecommendedAlbum("a:playing"), { wrapper });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data?.id).toBe("a:match");
      unmount();
    }
  });
});
