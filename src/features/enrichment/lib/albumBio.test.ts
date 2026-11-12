import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/lastfm", () => ({ fetchAlbumInfo: vi.fn() }));
vi.mock("../../../clients/musicbrainz", () => ({ fetchReleaseGroupWikidataId: vi.fn() }));
vi.mock("../../../clients/wikipedia", () => ({
  fetchWikipediaTitleByReleaseGroup: vi.fn(),
  fetchWikipediaTitleByWikidataId: vi.fn(),
  fetchWikipediaSummaryText: vi.fn(),
}));

import { fetchAlbumInfo } from "../../../clients/lastfm";
import { fetchReleaseGroupWikidataId } from "../../../clients/musicbrainz";
import {
  fetchWikipediaSummaryText,
  fetchWikipediaTitleByReleaseGroup,
  fetchWikipediaTitleByWikidataId,
} from "../../../clients/wikipedia";
import { fetchAlbumBio } from "./albumBio";

const RELEASE_GROUP = "46482030-ef12-319c-9c5a-5d04c39d574b";
const SOUVLAKI = { artist: "Slowdive", album: "Souvlaki", releaseGroupMbid: RELEASE_GROUP };

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchAlbumBio", () => {
  it("keeps Last.fm's description and asks Wikipedia nothing", async () => {
    vi.mocked(fetchAlbumInfo).mockResolvedValue({ bio: "From Last.fm", url: "https://last.fm/a" });

    await expect(fetchAlbumBio(SOUVLAKI)).resolves.toEqual({ bio: "From Last.fm", url: "https://last.fm/a" });
    expect(fetchWikipediaTitleByReleaseGroup).not.toHaveBeenCalled();
  });

  it("reads Wikipedia's article for the release group when Last.fm has none", async () => {
    vi.mocked(fetchAlbumInfo).mockResolvedValue({ bio: null, url: "https://last.fm/a" });
    vi.mocked(fetchWikipediaTitleByReleaseGroup).mockResolvedValue("Souvlaki_(album)");
    vi.mocked(fetchWikipediaSummaryText).mockResolvedValue("Souvlaki is the second studio album.");

    await expect(fetchAlbumBio(SOUVLAKI)).resolves.toEqual({
      bio: "Souvlaki is the second studio album.",
      url: "https://last.fm/a",
    });
    expect(fetchWikipediaSummaryText).toHaveBeenCalledExactlyOnceWith("Souvlaki_(album)");
    expect(fetchReleaseGroupWikidataId).not.toHaveBeenCalled();
  });

  it("follows MusicBrainz's Wikidata link when no item carries the release group id", async () => {
    vi.mocked(fetchAlbumInfo).mockResolvedValue({ bio: null, url: null });
    vi.mocked(fetchWikipediaTitleByReleaseGroup).mockResolvedValue(null);
    vi.mocked(fetchReleaseGroupWikidataId).mockResolvedValue("Q1582736");
    vi.mocked(fetchWikipediaTitleByWikidataId).mockResolvedValue("Souvlaki (album)");
    vi.mocked(fetchWikipediaSummaryText).mockResolvedValue("Souvlaki is the second studio album.");

    await expect(fetchAlbumBio(SOUVLAKI)).resolves.toEqual({ bio: "Souvlaki is the second studio album.", url: null });
    expect(fetchWikipediaTitleByWikidataId).toHaveBeenCalledExactlyOnceWith("Q1582736");
  });

  it("finds none when every source answered without one", async () => {
    vi.mocked(fetchAlbumInfo).mockResolvedValue({ bio: null, url: null });
    vi.mocked(fetchWikipediaTitleByReleaseGroup).mockResolvedValue(null);
    vi.mocked(fetchReleaseGroupWikidataId).mockResolvedValue(null);

    await expect(fetchAlbumBio(SOUVLAKI)).resolves.toEqual({ bio: null, url: null });
    expect(fetchWikipediaSummaryText).not.toHaveBeenCalled();
  });

  it("asks only Last.fm for an album MusicBrainz hasn't matched", async () => {
    vi.mocked(fetchAlbumInfo).mockResolvedValue({ bio: null, url: null });

    await expect(fetchAlbumBio({ ...SOUVLAKI, releaseGroupMbid: null })).resolves.toEqual({ bio: null, url: null });
    expect(fetchWikipediaTitleByReleaseGroup).not.toHaveBeenCalled();
  });

  it("rejects when Wikipedia failed, so the missing description isn't stored as none", async () => {
    vi.mocked(fetchAlbumInfo).mockResolvedValue({ bio: null, url: null });
    vi.mocked(fetchWikipediaTitleByReleaseGroup).mockResolvedValue("Souvlaki_(album)");
    vi.mocked(fetchWikipediaSummaryText).mockRejectedValue(new Error("Wikipedia returned 503"));

    await expect(fetchAlbumBio(SOUVLAKI)).rejects.toThrow("503");
  });

  it("still takes Wikipedia's description when Last.fm failed", async () => {
    vi.mocked(fetchAlbumInfo).mockRejectedValue(new Error("Last.fm album.getInfo returned 500"));
    vi.mocked(fetchWikipediaTitleByReleaseGroup).mockResolvedValue("Souvlaki_(album)");
    vi.mocked(fetchWikipediaSummaryText).mockResolvedValue("Souvlaki is the second studio album.");

    await expect(fetchAlbumBio(SOUVLAKI)).resolves.toEqual({ bio: "Souvlaki is the second studio album.", url: null });
  });

  it("rejects when Last.fm failed and Wikipedia has none", async () => {
    vi.mocked(fetchAlbumInfo).mockRejectedValue(new Error("Last.fm album.getInfo returned 500"));
    vi.mocked(fetchWikipediaTitleByReleaseGroup).mockResolvedValue(null);
    vi.mocked(fetchReleaseGroupWikidataId).mockResolvedValue(null);

    await expect(fetchAlbumBio(SOUVLAKI)).rejects.toThrow("500");
  });
});
