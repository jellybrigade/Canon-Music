import { describe, expect, it } from "vitest";
import { describeReplayGainCoverage, type ReplayGainCoverage } from "./replaygainCoverage";

function coverage(over: Partial<ReplayGainCoverage> = {}): ReplayGainCoverage {
  return { total: 100, withTrackGain: 0, withAlbumGain: 0, withAnyGain: 0, ...over };
}

describe("describeReplayGainCoverage", () => {
  it("says there is nothing to measure before a library exists", () => {
    const s = describeReplayGainCoverage(coverage({ total: 0 }), "album", -6);
    expect(s.headline).toContain("No tracks synced yet");
    expect(s.detail).toBe("");
  });

  it("names the count of tracks the chosen mode can actually use", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 17678, withTrackGain: 1151, withAlbumGain: 705, withAnyGain: 1157 }),
      "album",
      -6
    );
    expect(s.headline).toBe("705 of 17,678 tracks (4%) carry album gain.");
  });

  it("counts the cross-fallback separately from the untagged remainder", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 17678, withTrackGain: 1151, withAlbumGain: 705, withAnyGain: 1157 }),
      "album",
      -6
    );
    expect(s.detail).toBe("452 more fall back to track gain. 16,521 have no tags and play at the fallback gain (-6 dB).");
  });

  it("swaps which gain is preferred in track mode", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 1000, withTrackGain: 400, withAlbumGain: 450, withAnyGain: 500 }),
      "track",
      -3
    );
    expect(s.headline).toBe("400 of 1,000 tracks (40%) carry track gain.");
    expect(s.detail).toBe("100 more fall back to album gain. 500 have no tags and play at the fallback gain (-3 dB).");
  });

  it("reports a fully tagged library without a fallback clause", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 50, withTrackGain: 50, withAlbumGain: 50, withAnyGain: 50 }),
      "track",
      -6
    );
    expect(s.headline).toBe("50 of 50 tracks (100%) carry track gain.");
    expect(s.detail).toBe("Every track in this library is normalized.");
  });

  it("states plainly that nothing is normalized when no track carries tags", () => {
    const s = describeReplayGainCoverage(coverage({ total: 17678 }), "album", -6);
    expect(s.headline).toBe("No track in this library carries ReplayGain tags.");
    expect(s.detail).toBe("All 17,678 play at the fallback gain (-6 dB), so this mode sounds the same as Off.");
  });

  it("tells the user what switching on would buy them while off", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 17678, withTrackGain: 1151, withAlbumGain: 705, withAnyGain: 1157 }),
      "off",
      -6
    );
    expect(s.headline).toBe("Tracks play at their original level.");
    expect(s.detail).toBe("1,157 of 17,678 tracks (7%) carry ReplayGain tags.");
  });

  it("rounds a nonzero sliver to under one percent instead of to zero", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 10000, withTrackGain: 3, withAlbumGain: 3, withAnyGain: 3 }),
      "track",
      -6
    );
    expect(s.headline).toBe("3 of 10,000 tracks (<1%) carry track gain.");
  });

  it("shows a positive fallback gain with its sign", () => {
    const s = describeReplayGainCoverage(
      coverage({ total: 10, withTrackGain: 1, withAlbumGain: 1, withAnyGain: 1 }),
      "track",
      2
    );
    expect(s.detail).toContain("(+2 dB)");
  });
});
