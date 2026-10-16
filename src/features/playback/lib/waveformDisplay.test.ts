import { describe, expect, it } from "vitest";
import { displayedWaveformPeaks, fitWaveformPeaks, WAVEFORM_BAR_COUNT, WAVEFORM_STUB_PEAK } from "./waveformDisplay";

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

describe("fitWaveformPeaks", () => {
  const peaks = [0.1, 0.9, 0.2, 0.3, 0.8, 0.4, 0.5, 0.6];

  it("fits one bar per pitch of width", () => {
    expect(fitWaveformPeaks(peaks, 16, 4)).toHaveLength(4);
    expect(fitWaveformPeaks(peaks, 19, 4)).toHaveLength(4);
  });

  it("keeps the loudest peak of each merged run so short hits survive", () => {
    expect(fitWaveformPeaks(peaks, 16, 4)).toEqual([0.9, 0.3, 0.8, 0.6]);
  });

  it("merges uneven runs without dropping or repeating a peak", () => {
    expect(fitWaveformPeaks([0.1, 0.2, 0.9, 0.3, 0.4], 12, 4)).toEqual([0.1, 0.9, 0.4]);
  });

  it("never stretches the peaks into more bars than they have", () => {
    expect(fitWaveformPeaks(peaks, 1000, 4)).toBe(peaks);
  });

  it("returns the peaks unchanged before the width is known", () => {
    expect(fitWaveformPeaks(peaks, 0, 4)).toBe(peaks);
  });

  it("still draws one bar when the width is narrower than a pitch", () => {
    expect(fitWaveformPeaks(peaks, 2, 4)).toEqual([0.9]);
  });
});
