import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/lastfm", () => ({ fetchArtistTopTracks: vi.fn() }));
vi.mock("../../../clients/deezer", () => ({ searchDeezerArtists: vi.fn(), fetchDeezerArtistTopTracks: vi.fn() }));

import { fetchDeezerArtistTopTracks, searchDeezerArtists } from "../../../clients/deezer";
import { fetchArtistTopTracks } from "../../../clients/lastfm";
import { fetchPopularTrackRanking } from "./popularTracks";

function ranking() {
  return fetchPopularTrackRanking({ artistName: "Weatherday", lastfmName: "Weatherday " });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchPopularTrackRanking", () => {
  it("keeps Last.fm's order and play counts and asks Deezer nothing", async () => {
    vi.mocked(fetchArtistTopTracks).mockResolvedValue([{ name: "Older Than Clouds", playcount: 900 }]);

    await expect(ranking()).resolves.toEqual({
      source: "lastfm",
      tracks: [{ title: "Older Than Clouds", playcount: 900, albumTitle: null }],
    });
    expect(fetchArtistTopTracks).toHaveBeenCalledWith("Weatherday ");
    expect(searchDeezerArtists).not.toHaveBeenCalled();
  });

  it("takes Deezer's order, with albums and no counts, when Last.fm has none", async () => {
    vi.mocked(fetchArtistTopTracks).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockResolvedValue([
      { id: 7, name: "Weatherday" },
      { id: 8, name: "Weatherday Tribute" },
    ]);
    vi.mocked(fetchDeezerArtistTopTracks).mockResolvedValue([
      { title: "My Nausea", albumTitle: "Come In" },
      { title: "Agitated Cell", albumTitle: null },
    ]);

    await expect(ranking()).resolves.toEqual({
      source: "deezer",
      tracks: [
        { title: "My Nausea", playcount: null, albumTitle: "Come In" },
        { title: "Agitated Cell", playcount: null, albumTitle: null },
      ],
    });
    expect(searchDeezerArtists).toHaveBeenCalledWith("Weatherday");
    expect(fetchDeezerArtistTopTracks).toHaveBeenCalledWith(7);
  });

  it("takes Deezer's order when Last.fm failed", async () => {
    vi.mocked(fetchArtistTopTracks).mockRejectedValue(new Error("Last.fm returned 503"));
    vi.mocked(searchDeezerArtists).mockResolvedValue([{ id: 7, name: "Weatherday" }]);
    vi.mocked(fetchDeezerArtistTopTracks).mockResolvedValue([{ title: "My Nausea", albumTitle: "Come In" }]);

    await expect(ranking()).resolves.toMatchObject({ source: "deezer", tracks: [{ title: "My Nausea" }] });
  });

  it("ranks nothing when two Deezer artists share the name", async () => {
    vi.mocked(fetchArtistTopTracks).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockResolvedValue([
      { id: 7, name: "Weatherday" },
      { id: 9, name: "weatherday" },
    ]);

    await expect(ranking()).resolves.toEqual({ source: "deezer", tracks: [] });
    expect(fetchDeezerArtistTopTracks).not.toHaveBeenCalled();
  });

  it("rejects when Deezer fails after Last.fm had none", async () => {
    vi.mocked(fetchArtistTopTracks).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockRejectedValue(new Error("Deezer returned 502"));

    await expect(ranking()).rejects.toThrow("Deezer returned 502");
  });

  it("rejects with Last.fm's failure when Deezer then has none", async () => {
    vi.mocked(fetchArtistTopTracks).mockRejectedValue(new Error("Last.fm returned 503"));
    vi.mocked(searchDeezerArtists).mockResolvedValue([]);

    await expect(ranking()).rejects.toThrow("Last.fm returned 503");
  });
});
