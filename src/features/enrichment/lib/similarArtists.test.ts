import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../clients/lastfm", () => ({ fetchSimilarArtistsFull: vi.fn() }));
vi.mock("../../../clients/listenbrainz", () => ({ fetchListenBrainzSimilarArtists: vi.fn() }));
vi.mock("../../../clients/deezer", () => ({ searchDeezerArtists: vi.fn(), fetchDeezerRelatedArtists: vi.fn() }));

import { fetchDeezerRelatedArtists, searchDeezerArtists } from "../../../clients/deezer";
import { fetchSimilarArtistsFull } from "../../../clients/lastfm";
import { fetchListenBrainzSimilarArtists } from "../../../clients/listenbrainz";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { fetchSimilarArtistScores } from "./similarArtists";

const MBID = "eea5d1b3-d4b9-45a9-b8cd-c480fd259a3e";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(fetchSimilarArtistsFull).mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

function storeMbid(artistName: string, mbid: string) {
  db.raw.prepare("INSERT INTO artist_identity (artist_name, mb_artist_id) VALUES (?, ?)").run(artistName, mbid);
}

describe("fetchSimilarArtistScores", () => {
  it("keeps Last.fm's list and scores and asks no one else", async () => {
    vi.mocked(fetchSimilarArtistsFull).mockResolvedValue([{ name: "Duster", match: 0.8 }]);

    await expect(fetchSimilarArtistScores("Weatherday")).resolves.toEqual([{ name: "Duster", match: 0.8 }]);
    expect(fetchListenBrainzSimilarArtists).not.toHaveBeenCalled();
    expect(searchDeezerArtists).not.toHaveBeenCalled();
  });

  it("asks ListenBrainz by the stored MBID when Last.fm has none, best scoring 1", async () => {
    storeMbid("Weatherday", MBID);
    vi.mocked(fetchListenBrainzSimilarArtists).mockResolvedValue([
      { mbid: "a", name: "Sweet Trip", score: 200 },
      { mbid: "b", name: "Duster", score: 50 },
    ]);

    await expect(fetchSimilarArtistScores("Weatherday")).resolves.toEqual([
      { name: "Sweet Trip", match: 1 },
      { name: "Duster", match: 0.25 },
    ]);
    expect(fetchListenBrainzSimilarArtists).toHaveBeenCalledWith(MBID);
    expect(searchDeezerArtists).not.toHaveBeenCalled();
  });

  it("scores Deezer's related artists by their order when there's no MBID", async () => {
    vi.mocked(searchDeezerArtists).mockResolvedValue([{ id: 69103042, name: "Weatherday" }]);
    vi.mocked(fetchDeezerRelatedArtists).mockResolvedValue([
      { id: 1, name: "Asian Glow" },
      { id: 2, name: "Horse Jumper of Love" },
      { id: 3, name: "Parannoul" },
      { id: 4, name: "Duster" },
    ]);

    await expect(fetchSimilarArtistScores("Weatherday")).resolves.toEqual([
      { name: "Asian Glow", match: 1 },
      { name: "Horse Jumper of Love", match: 0.75 },
      { name: "Parannoul", match: 0.5 },
      { name: "Duster", match: 0.25 },
    ]);
    expect(fetchListenBrainzSimilarArtists).not.toHaveBeenCalled();
  });

  it("asks the fallback sources once per artist, not on every call", async () => {
    vi.mocked(searchDeezerArtists).mockResolvedValue([{ id: 69103042, name: "Weatherday" }]);
    vi.mocked(fetchDeezerRelatedArtists).mockResolvedValue([{ id: 1, name: "Asian Glow" }]);

    await fetchSimilarArtistScores("Weatherday");
    await expect(fetchSimilarArtistScores("weatherday")).resolves.toEqual([{ name: "Asian Glow", match: 1 }]);
    expect(searchDeezerArtists).toHaveBeenCalledTimes(1);
    expect(fetchDeezerRelatedArtists).toHaveBeenCalledTimes(1);
  });

  it("remembers no failure as 'none', so the next call asks again", async () => {
    storeMbid("Weatherday", MBID);
    vi.mocked(fetchListenBrainzSimilarArtists).mockRejectedValue(new Error("timed out"));
    vi.mocked(searchDeezerArtists).mockRejectedValue(new Error("Deezer returned 502"));

    await expect(fetchSimilarArtistScores("Weatherday")).resolves.toEqual([]);

    vi.mocked(fetchListenBrainzSimilarArtists).mockResolvedValue([{ mbid: "a", name: "Sweet Trip", score: 9 }]);
    await expect(fetchSimilarArtistScores("Weatherday")).resolves.toEqual([{ name: "Sweet Trip", match: 1 }]);
  });
});
