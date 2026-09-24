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
  // Clipping prevention: cap so that peak sample stays at or below 1.0. Peak is optional in the
  // tags and most files carry none, so an absent one means there is nothing to clip against -
  // standing in a full-scale peak here would cancel every positive pre-amp and fallback gain
  // for the whole library and leave both settings looking dead.
  if (peak == null || peak <= 0) return linear;
  return Math.min(linear, 1.0 / peak);
}
