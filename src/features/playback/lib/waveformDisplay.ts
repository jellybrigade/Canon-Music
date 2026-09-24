export const WAVEFORM_BAR_COUNT = 200;
export const WAVEFORM_STUB_PEAK = 0.1;

// Stands in for a track whose peaks haven't loaded, so the bar keeps its waveform height
// across a track change instead of dropping to the thin bar and back. Flat, so it can never
// pass for the previous track's shape.
const PLACEHOLDER_PEAKS: readonly number[] = new Array<number>(WAVEFORM_BAR_COUNT).fill(WAVEFORM_STUB_PEAK);

export function displayedWaveformPeaks(
  showWaveform: boolean,
  peaks: number[] | null
): readonly number[] | null {
  if (!showWaveform) return null;
  return peaks && peaks.length > 0 ? peaks : PLACEHOLDER_PEAKS;
}
