// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useEnrichArtist.ts`'s per-mount enrichment claim.
 *
 * Regression pinned: known-issues "A per-mount claim on work keyed by an argument". `AlbumDetail`
 * calls this hook with `album.artist` and is rendered without a `key`, so an album swap changes
 * the artist inside one mount. A claim stored as a bare boolean then stands against the new
 * artist and nothing enriches it for the life of that mount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../clients/lastfm", () => ({
  fetchArtistInfo: vi.fn().mockResolvedValue({
    bio: "bio",
    listeners: 1,
    playcount: 2,
    similar: [],
    topTags: [],
    imageUrl: null,
    url: null,
  }),
}));
vi.mock("../../../clients/listenbrainz", () => ({
  fetchListenBrainzSimilarArtists: vi.fn().mockResolvedValue([]),
  fetchListenBrainzArtistPopularity: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../clients/deezer", () => ({
  searchDeezerArtists: vi.fn().mockResolvedValue([]),
  fetchDeezerRelatedArtists: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../clients/musicbrainz", () => ({
  searchArtists: vi.fn().mockResolvedValue([]),
  fetchWikidataImageByMbid: vi.fn().mockResolvedValue(null),
  fetchArtistReleaseGroupTitles: vi.fn().mockResolvedValue([]),
  lookupArtist: vi.fn(),
}));
vi.mock("../../../clients/wikidata", () => ({ fetchWikidataClaims: vi.fn().mockResolvedValue(null) }));
vi.mock("../../../clients/fanart", () => ({
  getFanartApiKey: vi.fn().mockResolvedValue(null),
  fetchFanartTvImageByMbid: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../clients/theaudiodb", () => ({
  fetchTheAudioDbArtist: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../clients/wikipedia", () => ({
  fetchWikipediaTitleByArtist: vi.fn().mockResolvedValue(null),
  fetchWikipediaSummaryText: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../clients/navidrome", () => ({ getArtistImageFromServer: vi.fn().mockResolvedValue(null) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getFanartApiKey } from "../../../clients/fanart";
import { fetchArtistInfo } from "../../../clients/lastfm";
import { fetchListenBrainzArtistPopularity, fetchListenBrainzSimilarArtists } from "../../../clients/listenbrainz";
import { fetchWikidataImageByMbid, lookupArtist, searchArtists } from "../../../clients/musicbrainz";
import { fetchTheAudioDbArtist } from "../../../clients/theaudiodb";
import { fetchWikipediaSummaryText, fetchWikipediaTitleByArtist } from "../../../clients/wikipedia";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createMigratedTestDb, type FakeDatabase, holdSettingReads } from "../../../test/sqlite";
import { __resetIdentifyAttempts, useEnrichArtist } from "./useEnrichArtist";

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
    .get(name) as
    | { mb_artist_id: string | null; confirmed_at: number | null; bio: string | null; enriched_at: number | null }
    | undefined;
}

const SINGLE_MATCH = [{ id: "mbid-1", name: "slowdive", disambiguation: null, country: null, score: 100 }];

beforeEach(async () => {
  vi.mocked(lookupArtist).mockResolvedValue({
    id: "mbid-1",
    name: "slowdive",
    disambiguation: null,
    country: "GB",
    genres: [],
    type: "Group",
    lifeSpanBegin: "1989",
    wikidataId: null,
  });
  __resetSettingCache();
  __resetIdentifyAttempts();
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

  it("leaves an artist enriched within the stored staleness window alone, even before it is read back", async () => {
    const sixtyDaysAgo = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
    db.raw
      .prepare("INSERT INTO artist_identity (artist_name, lastfm_artist_name, enriched_at) VALUES (?, ?, ?)")
      .run("slowdive", "slowdive", sixtyDaysAgo);
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('tags.staleness_days', '365')").run();
    const releaseSettings = holdSettingReads(db, "tags.staleness_days");
    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(queryClient.getQueryState(QK.artistEnrichment("slowdive"))?.status).toBe("success"));
    await act(async () => {});
    await act(async () => releaseSettings());
    await act(async () => {});
    expect(fetchArtistInfo).not.toHaveBeenCalled();
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

    const { rerender } = renderHook(({ enabled }: { enabled: boolean }) => useEnrichArtist("slowdive", { enabled }), {
      wrapper,
      initialProps: { enabled: true },
    });

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

  it("keeps the artist retryable when the fanart.tv key can't be read", async () => {
    vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
    vi.mocked(getFanartApiKey).mockRejectedValueOnce(new Error("keyring is locked"));

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
      bio: null,
      listeners: 1,
      playcount: 2,
      similar: [],
      topTags: [],
      imageUrl: null,
    });
    vi.mocked(fetchTheAudioDbArtist).mockRejectedValueOnce(new Error("theaudiodb unreachable"));

    renderHook(() => useEnrichArtist("slowdive"), { wrapper });

    await waitFor(() => expect(storedIdentity("slowdive")).toBeDefined());
    expect(storedIdentity("slowdive")?.enriched_at).toBeNull();
  });

  describe("biography fallbacks", () => {
    const NO_LASTFM_BIO = { bio: null, listeners: 1, playcount: 2, similar: [], topTags: [], imageUrl: null };

    function seedStoredBio(bio: string) {
      db.raw.prepare("INSERT INTO artist_identity (artist_name, bio) VALUES (?, ?)").run("slowdive", bio);
    }

    it("stores the Wikipedia article linked from the artist's MusicBrainz id", async () => {
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM_BIO);
      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
      vi.mocked(fetchWikipediaTitleByArtist).mockResolvedValueOnce("Slowdive");
      vi.mocked(fetchWikipediaSummaryText).mockResolvedValueOnce("Slowdive are an English rock band.");

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
      expect(storedIdentity("slowdive")?.bio).toBe("Slowdive are an English rock band.");
      expect(fetchWikipediaTitleByArtist).toHaveBeenCalledWith("mbid-1");
      expect(fetchWikipediaSummaryText).toHaveBeenCalledWith("Slowdive");
    });

    it("keeps the stored biography and the artist due when Wikipedia doesn't answer", async () => {
      seedStoredBio("Stored bio");
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM_BIO);
      vi.mocked(fetchWikipediaSummaryText).mockRejectedValueOnce(new Error("Wikipedia returned 503"));

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(fetchWikipediaSummaryText).toHaveBeenCalledOnce());
      await waitFor(() => expect(storedIdentity("slowdive")?.bio).toBe("Stored bio"));
      expect(storedIdentity("slowdive")?.enriched_at).toBeNull();
    });

    it("keeps the stored biography and the artist due when the artist's Wikidata link can't be read", async () => {
      seedStoredBio("Stored bio");
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM_BIO);
      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
      vi.mocked(fetchWikidataImageByMbid).mockResolvedValueOnce("https://img/slowdive.jpg");
      vi.mocked(fetchWikipediaTitleByArtist).mockRejectedValueOnce(new Error("Wikidata returned 429"));

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-1"));
      expect(storedIdentity("slowdive")).toMatchObject({ bio: "Stored bio", enriched_at: null });
      // A name lookup could land on another artist's article ("Ye"), so a failed id lookup waits for a retry.
      expect(fetchWikipediaSummaryText).not.toHaveBeenCalled();
    });

    it("keeps the stored biography when TheAudioDB fails, even with a portrait found", async () => {
      seedStoredBio("Stored bio");
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM_BIO);
      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
      vi.mocked(fetchWikidataImageByMbid).mockResolvedValueOnce("https://img/slowdive.jpg");
      vi.mocked(fetchTheAudioDbArtist).mockRejectedValueOnce(new Error("theaudiodb unreachable"));

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-1"));
      expect(storedIdentity("slowdive")).toMatchObject({ bio: "Stored bio", enriched_at: null });
    });

    it("clears the biography once every source answered that it has none", async () => {
      seedStoredBio("Stored bio");
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM_BIO);

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
      expect(storedIdentity("slowdive")?.bio).toBeNull();
    });
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

  describe("without Last.fm", () => {
    const NO_LASTFM = { bio: null, listeners: null, playcount: null, similar: [], topTags: [], imageUrl: null };

    function storedListening(name: string) {
      return db.raw
        .prepare("SELECT similar_json, listenbrainz_listens, enriched_at FROM artist_identity WHERE artist_name = ?")
        .get(name) as { similar_json: string | null; listenbrainz_listens: number | null; enriched_at: number | null };
    }

    it("stores ListenBrainz's similar artists and listen count and marks the artist done", async () => {
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM);
      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
      vi.mocked(fetchListenBrainzSimilarArtists).mockResolvedValueOnce([{ mbid: "m", name: "Ride", score: 5 }]);
      vi.mocked(fetchListenBrainzArtistPopularity).mockResolvedValueOnce([
        { mbid: "mbid-1", listenCount: 50, userCount: 3 },
      ]);

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
      expect(storedListening("slowdive")).toMatchObject({ similar_json: '["Ride"]', listenbrainz_listens: 50 });
      expect(fetchListenBrainzSimilarArtists).toHaveBeenCalledWith("mbid-1");
    });

    it("keeps the similar artists stored and the artist due when ListenBrainz fails", async () => {
      db.raw
        .prepare("INSERT INTO artist_identity (artist_name, similar_json, listenbrainz_listens) VALUES (?, ?, ?)")
        .run("slowdive", '["Ride"]', 50);
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM);
      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
      vi.mocked(fetchListenBrainzSimilarArtists).mockRejectedValueOnce(new Error("ListenBrainz returned 400"));
      vi.mocked(fetchListenBrainzArtistPopularity).mockRejectedValueOnce(new Error("ListenBrainz returned 429"));

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(fetchListenBrainzArtistPopularity).toHaveBeenCalledOnce());
      await waitFor(() => expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-1"));
      expect(storedListening("slowdive")).toEqual({
        similar_json: '["Ride"]',
        listenbrainz_listens: 50,
        enriched_at: null,
      });
    });

    it("leaves the artist due when no source knows anything about it", async () => {
      vi.mocked(fetchArtistInfo).mockResolvedValueOnce(NO_LASTFM);

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(storedIdentity("slowdive")).toBeDefined());
      expect(storedIdentity("slowdive")?.enriched_at).toBeNull();
    });
  });

  describe("identifying an in-library artist", () => {
    function seedFreshUnidentified(name: string) {
      db.raw
        .prepare("INSERT INTO artist_identity (artist_name, bio, enriched_at) VALUES (?, 'bio', ?)")
        .run(name, Math.floor(Date.now() / 1000));
    }

    it("identifies an artist enriched recently but never matched", async () => {
      seedFreshUnidentified("slowdive");
      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);

      renderHook(() => useEnrichArtist("slowdive", { identifyIfUnidentified: true }), { wrapper });

      await waitFor(() => expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-1"));
      expect(storedIdentity("slowdive")?.confirmed_at).toBeNull();
    });

    it("leaves a recently enriched artist alone unless asked", async () => {
      seedFreshUnidentified("slowdive");

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(queryClient.getQueryData(QK.artistEnrichment("slowdive"))).toBeDefined());
      expect(vi.mocked(searchArtists)).not.toHaveBeenCalled();
    });

    it("searches once per session when no match is confident", async () => {
      seedFreshUnidentified("slowdive");
      vi.mocked(searchArtists).mockResolvedValueOnce([{ ...SINGLE_MATCH[0]!, score: 50 }]);

      const first = renderHook(() => useEnrichArtist("slowdive", { identifyIfUnidentified: true }), { wrapper });
      await waitFor(() => expect(vi.mocked(fetchArtistInfo)).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(vi.mocked(searchArtists)).toHaveBeenCalledTimes(1));
      first.unmount();

      renderHook(() => useEnrichArtist("slowdive", { identifyIfUnidentified: true }), { wrapper });
      await waitFor(() => expect(queryClient.getQueryData(QK.artistEnrichment("slowdive"))).toBeDefined());

      expect(vi.mocked(searchArtists)).toHaveBeenCalledTimes(1);
    });

    it("tries again on the next visit when the MusicBrainz search fails", async () => {
      seedFreshUnidentified("slowdive");
      vi.mocked(searchArtists).mockRejectedValueOnce(new Error("musicbrainz unreachable"));

      const first = renderHook(() => useEnrichArtist("slowdive", { identifyIfUnidentified: true }), { wrapper });
      await waitFor(() => expect(vi.mocked(searchArtists)).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(vi.mocked(fetchArtistInfo)).toHaveBeenCalledTimes(1));
      first.unmount();

      vi.mocked(searchArtists).mockResolvedValueOnce(SINGLE_MATCH);
      renderHook(() => useEnrichArtist("slowdive", { identifyIfUnidentified: true }), { wrapper });

      await waitFor(() => expect(storedIdentity("slowdive")?.mb_artist_id).toBe("mbid-1"));
    });
  });

  describe("artist facts", () => {
    function storedFacts(name: string) {
      return db.raw
        .prepare(
          "SELECT artist_type, country_code, begin_year, facts_source, facts_mb_artist_id, enriched_at FROM artist_identity WHERE artist_name = ?",
        )
        .get(name) as Record<string, unknown> | undefined;
    }

    function seedIdentified(name: string, enrichedAt: number | null) {
      db.raw
        .prepare(
          "INSERT INTO artist_identity (artist_name, mb_artist_id, bio, enriched_at) VALUES (?, 'mbid-1', 'bio', ?)",
        )
        .run(name, enrichedAt);
    }

    it("stores the type, country and starting year when the artist page asks for them", async () => {
      seedIdentified("slowdive", null);

      renderHook(() => useEnrichArtist("slowdive", { includeFacts: true }), { wrapper });

      await waitFor(() => expect(storedFacts("slowdive")?.facts_mb_artist_id).toBe("mbid-1"));
      expect(storedFacts("slowdive")).toMatchObject({
        artist_type: "Group",
        country_code: "GB",
        begin_year: 1989,
        facts_source: "musicbrainz",
      });
      expect(enrichedArtists()).toEqual(["slowdive"]);
    });

    it("asks nothing for them from a card that shows none", async () => {
      seedIdentified("slowdive", null);

      renderHook(() => useEnrichArtist("slowdive"), { wrapper });

      await waitFor(() => expect(enrichedArtists()).toEqual(["slowdive"]));
      expect(lookupArtist).not.toHaveBeenCalled();
      expect(storedFacts("slowdive")?.facts_mb_artist_id).toBeNull();
    });

    it("looks them up for an artist enriched recently but before facts were kept", async () => {
      seedIdentified("slowdive", Math.floor(Date.now() / 1000));

      renderHook(() => useEnrichArtist("slowdive", { includeFacts: true }), { wrapper });

      await waitFor(() => expect(storedFacts("slowdive")?.artist_type).toBe("Group"));
      expect(lookupArtist).toHaveBeenCalledTimes(1);
    });

    it("leaves a recently enriched artist alone once its facts are kept", async () => {
      seedIdentified("slowdive", Math.floor(Date.now() / 1000));
      db.raw.prepare("UPDATE artist_identity SET facts_mb_artist_id = 'mbid-1'").run();

      renderHook(() => useEnrichArtist("slowdive", { includeFacts: true }), { wrapper });

      await waitFor(() => expect(queryClient.getQueryData(QK.artistEnrichment("slowdive"))).toBeDefined());
      await act(async () => {});
      expect(fetchArtistInfo).not.toHaveBeenCalled();
    });

    it("looks them up again once the artist is matched to someone else", async () => {
      seedIdentified("slowdive", Math.floor(Date.now() / 1000));
      db.raw.prepare("UPDATE artist_identity SET mb_artist_id = 'mbid-2', facts_mb_artist_id = 'mbid-1'").run();

      renderHook(() => useEnrichArtist("slowdive", { includeFacts: true }), { wrapper });

      await waitFor(() => expect(storedFacts("slowdive")?.facts_mb_artist_id).toBe("mbid-2"));
      expect(lookupArtist).toHaveBeenCalledWith("mbid-2");
    });

    it("keeps stored facts and the artist retryable when the lookup fails", async () => {
      seedIdentified("slowdive", null);
      db.raw
        .prepare(
          "UPDATE artist_identity SET artist_type = 'Group', country_code = 'GB', begin_year = 1989, facts_source = 'musicbrainz'",
        )
        .run();
      vi.mocked(lookupArtist).mockRejectedValueOnce(new Error("MusicBrainz returned 503"));

      renderHook(() => useEnrichArtist("slowdive", { includeFacts: true }), { wrapper });

      await waitFor(() =>
        expect(db.raw.prepare("SELECT listeners FROM artist_identity").get()).toEqual({ listeners: 1 }),
      );
      expect(storedFacts("slowdive")).toMatchObject({
        artist_type: "Group",
        country_code: "GB",
        begin_year: 1989,
        facts_mb_artist_id: null,
        enriched_at: null,
      });
    });
  });
});
