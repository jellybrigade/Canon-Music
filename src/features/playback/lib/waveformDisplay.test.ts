import { describe, it, expect } from "vitest";
import { displayedWaveformPeaks, WAVEFORM_BAR_COUNT, WAVEFORM_STUB_PEAK } from "./waveformDisplay";

describe("displayedWaveformPeaks", () => {
  it("returns the loaded peaks unchanged", () => {
    const peaks = [0.2, 0.8, 0.5];
    expect(displayedWaveformPeaks(true, peaks)).toBe(peaks);
  });

  it("returns a flat placeholder while the track's peaks are still loading", () => {
    const placeholder = displayedWaveformPeaks(true, null);
    expect(placeholder).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(new Set(placeholder)).toEqual(new Set([WAVEFORM_STUB_PEAK]));
  });

  it("treats an empty peak list as still loading", () => {
    expect(displayedWaveformPeaks(true, [])).toHaveLength(WAVEFORM_BAR_COUNT);
  });

  it("returns the same placeholder array every time so memoised bars skip re-rendering", () => {
    expect(displayedWaveformPeaks(true, null)).toBe(displayedWaveformPeaks(true, []));
  });

  it("returns null when the waveform is turned off", () => {
    expect(displayedWaveformPeaks(false, [0.2, 0.8])).toBeNull();
    expect(displayedWaveformPeaks(false, null)).toBeNull();
  });
});
