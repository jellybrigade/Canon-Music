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

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../clients/lastfm", () => ({
  fetchArtistInfo: vi.fn().mockResolvedValue({
    bio: "bio", listeners: 1, playcount: 2, similar: [], topTags: [], imageUrl: null, url: null,
  }),
}));
vi.mock("../../../clients/musicbrainz", () => ({
  searchArtists: vi.fn().mockResolvedValue([]),
  fetchWikidataImageByMbid: vi.fn().mockResolvedValue(null),
  fetchArtistReleaseGroupTitles: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../clients/fanart", () => ({
  getFanartApiKey: vi.fn().mockResolvedValue(null),
  fetchFanartTvImageByMbid: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../clients/theaudiodb", () => ({
  fetchTheAudioDbArtist: vi.fn().mockResolvedValue(null),
  fetchWikipediaBio: vi.fn().mockResolvedValue(null),
  fetchWikipediaBioByMbid: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../clients/navidrome", () => ({ getArtistImageFromServer: vi.fn().mockResolvedValue(null) }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { fetchArtistInfo } from "../../../clients/lastfm";
import { fetchWikidataImageByMbid, searchArtists } from "../../../clients/musicbrainz";
import { fetchTheAudioDbArtist } from "../../../clients/theaudiodb";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { __resetSettingCache } from "../../../hooks/useSetting";
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

function storedIdentity(name: string) {
  return db.raw
    .prepare("SELECT mb_artist_id, confirmed_at, bio, enriched_at FROM artist_identity WHERE artist_name = ?")
    .get(name) as { mb_artist_id: string | null; confirmed_at: number | null; bio: string | null; enriched_at: number | null } | undefined;
}

const SINGLE_MATCH = [{ id: "mbid-1", name: "slowdive", disambiguation: null, country: null, score: 100 }];

beforeEach(async () => {
  __resetSettingCache();
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

  it("enriches the artist on a later attempt after one fails", async () => {
    vi.mocked(fetchArtistInfo).mockRejectedValueOnce(new Error("last.fm unreachable"));

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useEnrichArtist("slowdive", { enabled }),
      { wrapper, initialProps: { enabled: true } }
    );

    await waitFor(() => expect(vi.mocked(fetchArtistInfo)).toHaveBeenCalledTimes(1));
    expect(enrichedArtists()).toEqual([]);

    rerender({ enabled: false });
    rerender({ enabled: true });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
  });

  it("saves the MusicBrainz id when the name has a single match", async () => {
    vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
    expect(storedIdentity("slowdive")).toMatchObject({ mb_artist_id: "mbid-1", confirmed_at: null });
  });

  it("keeps the artist retryable when the MusicBrainz search fails", async () => {
    vi.mocked(searchArtists).mockRejectedValueOnce(new Error("musicbrainz unreachable"));

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(storedIdentity("slowdive")?.bio).toBe("bio"));
    expect(storedIdentity("slowdive")?.enriched_at).toBeNull();
  });

  it("keeps the artist retryable when the Wikidata portrait lookup fails", async () => {
    vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
    vi.mocked(fetchWikidataImageByMbid).mockRejectedValueOnce(new Error("wikidata timed out"));

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(storedIdentity("slowdive")?.bio).toBe("bio"));
    expect(storedIdentity("slowdive")).toMatchObject({ mb_artist_id: "mbid-1", enriched_at: null });
  });

  it("marks the artist done when Wikidata answers that it has no portrait", async () => {
    vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
    vi.mocked(fetchWikidataImageByMbid).mockResolvedValueOnce(null);

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
  });

  it("keeps the artist retryable when the TheAudioDB portrait fallback fails", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValueOnce({
      bio: null, listeners: 1, playcount: 2, similar: [], topTags: [], imageUrl: null,
    });
    vi.mocked(fetchTheAudioDbArtist).mockRejectedValueOnce(new Error("theaudiodb unreachable"));

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(storedIdentity("slowdive")).toBeDefined());
    expect(storedIdentity("slowdive")?.enriched_at).toBeNull();
  });

  it("picks the top MusicBrainz match when no other artist scores close to it", async () => {
    vi.mocked(searchArtists).mockResolvedValueOnce([
      { id: "mbid-weak", name: "slowdive", disambiguation: null, country: null, score: 60 },
      { id: "mbid-strong", name: "slowdive", disambiguation: null, country: null, score: 100 },
    ]);

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
    expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-strong");
  });

  it("leaves the artist unidentified when a single match scores below the minimum", async () => {
    vi.mocked(searchArtists).mockResolvedValueOnce([{ ...SINGLE_MATCH[0]!, score: 90 }]);

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
    expect(storedIdentity("slowdive")?.mb_artist_id).toBeNull();
  });

  it("uses the stored minimum score", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('mb.artist_auto_select_score', '80')").run();
    vi.mocked(searchArtists).mockResolvedValueOnce([{ ...SINGLE_MATCH[0]!, score: 90 }]);

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
    expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-1");
  });
});
