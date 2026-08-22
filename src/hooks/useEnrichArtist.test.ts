// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useEnrichArtist.ts`'s per-mount enrichment claim.
 *
 * Regression pinned: known-issues "A per-mount claim on work keyed by an argument". `AlbumDetail`
 * calls this hook with `album.artist` and is rendered without a `key`, so an album swap changes
 * the artist inside one mount. A claim stored as a bare boolean then stands against the new
 * artist and nothing enriches it for the life of that mount.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/lastfm", () => ({
  fetchArtistInfo: vi.fn().mockResolvedValue({
    bio: "bio", listeners: 1, playcount: 2, similar: [], topTags: [], imageUrl: null, url: null,
  }),
}));
vi.mock("../lib/musicbrainz", () => ({
  searchArtists: vi.fn().mockResolvedValue([]),
  fetchWikidataImageByMbid: vi.fn().mockResolvedValue(null),
  fetchArtistReleaseGroupTitles: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/fanart", () => ({
  getFanartApiKey: vi.fn().mockResolvedValue(null),
  fetchFanartTvImageByMbid: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lib/theaudiodb", () => ({
  fetchTheAudioDbArtist: vi.fn().mockResolvedValue(null),
  fetchWikipediaBio: vi.fn().mockResolvedValue(null),
  fetchWikipediaBioByMbid: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lib/navidrome", () => ({ getArtistImageFromServer: vi.fn().mockResolvedValue(null) }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchArtistInfo } from "../lib/lastfm";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { useEnrichArtist } from "./useEnrichArtist";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function enrichedArtists(): string[] {
  return (
    db.raw
      .prepare("SELECT artist_name FROM artist_identity WHERE enriched_at IS NOT NULL ORDER BY artist_name")
      .all() as { artist_name: string }[]
  ).map((r) => r.artist_name);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useEnrichArtist", () => {
  it("enriches a stale artist on mount", async () => {
    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
  });

  it("enriches the second artist when the view swaps artists without remounting", async () => {
    const { rerender } = renderHook(({ name }: { name: string }) => useEnrichArtist(name), {
      wrapper,
      initialProps: { name: "slowdive" },
    });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));

    rerender({ name: "ride" });

    await waitFor(() => expect(enrichedArtists()).toEqual(["ride", "slowdive"]));
    expect(vi.mocked(fetchArtistInfo)).toHaveBeenCalledTimes(2);
  });
});
