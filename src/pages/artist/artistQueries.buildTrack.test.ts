import { describe, expect, it } from "vitest";
import { buildTrackObj, type TopTrack } from "./artistQueries";
import { CRED, server, SRV } from "../../test/navidromeFixtures";

const TRACK: TopTrack = {
  id: `${SRV}:t1`,
  title: "Song",
  artist: "Artist",
  duration: 200,
  album_name: "Album",
  album_id: `${SRV}:al-1`,
  artwork_url: null,
  play_count: 3,
  played_at: null,
  replay_gain_track_gain: -5,
  replay_gain_track_peak: 0.8,
  replay_gain_album_gain: -6,
  replay_gain_album_peak: 0.9,
};

describe("buildTrackObj", () => {
  it("carries the track's ReplayGain tags into playback", () => {
    expect(buildTrackObj(TRACK, server(SRV), CRED).replayGain).toEqual({
      trackGain: -5,
      trackPeak: 0.8,
      albumGain: -6,
      albumPeak: 0.9,
    });
  });
});
