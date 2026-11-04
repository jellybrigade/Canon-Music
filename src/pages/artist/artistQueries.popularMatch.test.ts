import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../clients/lastfm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../clients/lastfm")>()),
  fetchTrackAlbum: vi.fn(),
}));

import { fetchTrackAlbum } from "../../clients/lastfm";
import type { PopularTrackRanking } from "../../features/enrichment/lib/popularTracks";
import { matchPopularTracks, type TopTrack } from "./artistQueries";

function track(id: string, title: string, albumName: string, playCount = 0): TopTrack {
  return {
    id,
    title,
    artist: "Weatherday",
    duration: 200,
    album_name: albumName,
    album_id: null,
    artwork_url: null,
    play_count: playCount,
    played_at: null,
    replay_gain_track_gain: null,
    replay_gain_track_peak: null,
    replay_gain_album_gain: null,
    replay_gain_album_peak: null,
  };
}

const LOCAL = [
  track("single", "My Nausea", "My Nausea", 9),
  track("album", "My Nausea", "Come In"),
  track("other", "Agitated Cell", "Come In"),
];

function ranked(matched: TopTrack[]) {
  return matched
    .filter((t) => t.popularRank !== undefined)
    .map((t) => ({ id: t.id, rank: t.popularRank, plays: t.lastfmPlaycount, combined: t.lastfmCombined }));
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("matchPopularTracks", () => {
  it("ranks Deezer's order with no play counts, its album picking the copy without asking Last.fm", async () => {
    const ranking: PopularTrackRanking = {
      source: "deezer",
      tracks: [
        { title: "Agitated Cell", playcount: null, albumTitle: "Come In" },
        { title: "My Nausea", playcount: null, albumTitle: "Come In" },
      ],
    };

    expect(ranked(await matchPopularTracks(LOCAL, ranking, "Weatherday"))).toEqual([
      { id: "album", rank: 1, plays: undefined, combined: undefined },
      { id: "other", rank: 0, plays: undefined, combined: undefined },
    ]);
    expect(fetchTrackAlbum).not.toHaveBeenCalled();
  });

  it("keeps Last.fm's counts and asks it which copy they belong to", async () => {
    vi.mocked(fetchTrackAlbum).mockResolvedValue("Come In");
    const ranking: PopularTrackRanking = {
      source: "lastfm",
      tracks: [{ title: "My Nausea", playcount: 900, albumTitle: null }],
    };

    expect(ranked(await matchPopularTracks(LOCAL, ranking, "Weatherday"))).toEqual([
      { id: "album", rank: 0, plays: 900, combined: true },
    ]);
    expect(fetchTrackAlbum).toHaveBeenCalledWith("Weatherday", "My Nausea");
  });
});
