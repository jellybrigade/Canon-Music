import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/lastfm", () => ({ fetchArtistInfo: vi.fn() }));
vi.mock("../../../clients/listenbrainz", () => ({
  fetchListenBrainzSimilarArtists: vi.fn(),
  fetchListenBrainzArtistPopularity: vi.fn(),
}));
vi.mock("../../../clients/deezer", () => ({ searchDeezerArtists: vi.fn(), fetchDeezerRelatedArtists: vi.fn() }));

import { fetchDeezerRelatedArtists, searchDeezerArtists } from "../../../clients/deezer";
import { fetchArtistInfo, type LastfmArtistInfo } from "../../../clients/lastfm";
import { fetchListenBrainzArtistPopularity, fetchListenBrainzSimilarArtists } from "../../../clients/listenbrainz";
import { fetchArtistListening } from "./artistListening";

const MBID = "eea5d1b3-d4b9-45a9-b8cd-c480fd259a3e";

function lastfmInfo(overrides: Partial<LastfmArtistInfo> = {}): LastfmArtistInfo {
  return { bio: null, listeners: null, playcount: null, similar: [], topTags: [], imageUrl: null, ...overrides };
}

function listening(mbid: string | null = MBID) {
  return fetchArtistListening({ artistName: "Weatherday", lastfmName: "Weatherday", mbid });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchArtistListening", () => {
  it("keeps Last.fm's similar artists and stats and asks no one else", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo({ listeners: 10, playcount: 20, similar: ["Duster"] }));

    await expect(listening()).resolves.toMatchObject({
      similar: ["Duster"],
      listenBrainz: { listens: null },
      isComplete: true,
    });
    expect(fetchListenBrainzSimilarArtists).not.toHaveBeenCalled();
    expect(fetchListenBrainzArtistPopularity).not.toHaveBeenCalled();
    expect(searchDeezerArtists).not.toHaveBeenCalled();
  });

  it("takes similar artists and listen counts from ListenBrainz when Last.fm has none", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo());
    vi.mocked(fetchListenBrainzSimilarArtists).mockResolvedValue([
      { mbid: "a", name: "Sweet Trip", score: 9 },
      { mbid: "b", name: "Duster", score: 8 },
    ]);
    vi.mocked(fetchListenBrainzArtistPopularity).mockResolvedValue([
      { mbid: MBID, listenCount: 141966, userCount: 3035 },
    ]);

    await expect(listening()).resolves.toMatchObject({
      similar: ["Sweet Trip", "Duster"],
      listenBrainz: { listens: 141966 },
      isComplete: true,
    });
    expect(fetchListenBrainzArtistPopularity).toHaveBeenCalledWith([MBID]);
    expect(searchDeezerArtists).not.toHaveBeenCalled();
  });

  it("falls back to Deezer's related artists for the one artist with the exact name", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo());
    vi.mocked(fetchListenBrainzSimilarArtists).mockRejectedValue(new Error("ListenBrainz returned 400"));
    vi.mocked(fetchListenBrainzArtistPopularity).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockResolvedValue([
      { id: 69103042, name: "Weatherday" },
      { id: 5, name: "Weatherday Tribute" },
    ]);
    vi.mocked(fetchDeezerRelatedArtists).mockResolvedValue([
      { id: 1, name: "Asian Glow" },
      { id: 2, name: "Parannoul" },
    ]);

    await expect(listening()).resolves.toMatchObject({ similar: ["Asian Glow", "Parannoul"], isComplete: true });
    expect(fetchDeezerRelatedArtists).toHaveBeenCalledWith(69103042);
  });

  it("asks Deezer when ListenBrainz knows no similar artists, and without an MBID", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo());
    vi.mocked(searchDeezerArtists).mockResolvedValue([{ id: 69103042, name: "Weatherday" }]);
    vi.mocked(fetchDeezerRelatedArtists).mockResolvedValue([{ id: 1, name: "Asian Glow" }]);

    await expect(listening(null)).resolves.toMatchObject({
      similar: ["Asian Glow"],
      listenBrainz: { listens: null },
      isComplete: true,
    });
    expect(fetchListenBrainzSimilarArtists).not.toHaveBeenCalled();
    expect(fetchListenBrainzArtistPopularity).not.toHaveBeenCalled();
  });

  it("takes no related artists from a name Deezer lists for two artists", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo());
    vi.mocked(searchDeezerArtists).mockResolvedValue([
      { id: 1, name: "Weatherday" },
      { id: 2, name: "weatherday" },
    ]);

    await expect(listening(null)).resolves.toMatchObject({ similar: [], isComplete: true });
    expect(fetchDeezerRelatedArtists).not.toHaveBeenCalled();
  });

  it("reports similar artists as unread, not empty, when every source failed", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo());
    vi.mocked(fetchListenBrainzSimilarArtists).mockRejectedValue(new Error("timed out"));
    vi.mocked(fetchListenBrainzArtistPopularity).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockRejectedValue(new Error("Deezer returned 502"));

    await expect(listening()).resolves.toMatchObject({ similar: null, isComplete: false });
  });

  it("reports similar artists as unread when Deezer has none but ListenBrainz failed", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo());
    vi.mocked(fetchListenBrainzSimilarArtists).mockRejectedValue(new Error("timed out"));
    vi.mocked(fetchListenBrainzArtistPopularity).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockResolvedValue([]);

    await expect(listening()).resolves.toMatchObject({ similar: null, isComplete: false });
  });

  it("reports listen counts as unread when ListenBrainz failed", async () => {
    vi.mocked(fetchArtistInfo).mockResolvedValue(lastfmInfo({ similar: ["Duster"] }));
    vi.mocked(fetchListenBrainzArtistPopularity).mockRejectedValue(new Error("ListenBrainz returned 429"));

    await expect(listening()).resolves.toMatchObject({
      similar: ["Duster"],
      listenBrainz: null,
      isComplete: false,
    });
  });

  it("rejects when Last.fm didn't answer, like Last.fm alone did", async () => {
    vi.mocked(fetchArtistInfo).mockRejectedValue(new Error("Last.fm artist.getInfo returned 503"));

    await expect(listening()).rejects.toThrow("503");
  });
});
