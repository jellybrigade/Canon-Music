import { describe, expect, it } from "vitest";
import { replayGainFromRow } from "./replayGainRow";

const NONE = {
  replay_gain_track_gain: null,
  replay_gain_track_peak: null,
  replay_gain_album_gain: null,
  replay_gain_album_peak: null,
};

describe("replayGainFromRow", () => {
  it("carries every tag the row holds", () => {
    expect(
      replayGainFromRow({
        replay_gain_track_gain: -7.5,
        replay_gain_track_peak: 0.9,
        replay_gain_album_gain: -8,
        replay_gain_album_peak: 0.95,
      })
    ).toEqual({ trackGain: -7.5, trackPeak: 0.9, albumGain: -8, albumPeak: 0.95 });
  });

  it("keeps a gain of zero, which is a real measurement", () => {
    expect(replayGainFromRow({ ...NONE, replay_gain_album_gain: 0 })).toEqual({
      trackGain: null,
      trackPeak: null,
      albumGain: 0,
      albumPeak: null,
    });
  });

  it("is null when the row has no gain, so playback uses the fallback", () => {
    expect(replayGainFromRow(NONE)).toBeNull();
    expect(replayGainFromRow({ ...NONE, replay_gain_track_peak: 0.8 })).toBeNull();
  });
});
