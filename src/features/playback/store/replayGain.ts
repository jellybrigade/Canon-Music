import type { CurrentTrack, ReplayGainMode } from "./playerTypes";

export function computeReplayGainLinear(
  rg: CurrentTrack["replayGain"],
  mode: ReplayGainMode,
  preAmpDb: number,
  fallbackDb: number
): number {
  if (mode === "off") return 1.0;
  const preferAlbum = mode === "album";
  const gainDb =
    (preferAlbum ? rg?.albumGain ?? rg?.trackGain : rg?.trackGain ?? rg?.albumGain) ?? fallbackDb;
  const peak = preferAlbum ? rg?.albumPeak ?? rg?.trackPeak : rg?.trackPeak ?? rg?.albumPeak;
  const linear = Math.pow(10, (gainDb + preAmpDb) / 20);
  // Peak is optional and usually absent; treat a missing peak as nothing to clip against,
  // not full-scale, or it would cancel pre-amp and fallback gain for the whole library.
  if (peak == null || peak <= 0) return linear;
  return Math.min(linear, 1.0 / peak);
}
