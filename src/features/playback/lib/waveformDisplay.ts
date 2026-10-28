export const WAVEFORM_BAR_COUNT = 200;
export const WAVEFORM_STUB_PEAK = 0.1;

// Stands in for a track whose peaks haven't loaded, so the bar keeps its waveform height
// across a track change instead of dropping to the thin bar and back. Flat, so it can never
// pass for the previous track's shape.
const PLACEHOLDER_PEAKS: readonly number[] = new Array<number>(WAVEFORM_BAR_COUNT).fill(WAVEFORM_STUB_PEAK);

export function displayedWaveformPeaks(showWaveform: boolean, peaks: number[] | null): readonly number[] | null {
  if (!showWaveform) return null;
  return peaks && peaks.length > 0 ? peaks : PLACEHOLDER_PEAKS;
}

// Fixed 200 bars squeezed into a narrow bar left each one a subpixel sliver between 1px gaps,
// so the bar count follows the width instead. Merged runs keep their loudest peak.
export function fitWaveformPeaks(peaks: readonly number[], width: number, barPitch: number): readonly number[] {
  const count = Math.max(1, Math.floor(width / barPitch));
  if (width <= 0 || count >= peaks.length) return peaks;
  const ratio = peaks.length / count;
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let loudest = 0;
    for (let j = start; j < end; j++) loudest = Math.max(loudest, peaks[j] ?? 0);
    return loudest;
  });
}

// Navidrome transcodes to low-bitrate mp3 for analysis: several times less to download and
// decode than the full-quality stream, and the 200 peaks can't tell the difference.
export function waveformStreamUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("maxBitRate", "32");
    u.searchParams.set("format", "mp3");
    return u.toString();
  } catch {
    return url;
  }
}
