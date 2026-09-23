import type { ReplayGainMode } from "../../playback/store/player";

export interface ReplayGainCoverage {
  total: number;
  withTrackGain: number;
  withAlbumGain: number;
  /** Tracks the player can normalize at all, since each mode falls back to the other's gain. */
  withAnyGain: number;
}

export interface CoverageSummary {
  headline: string;
  detail: string;
}

function percent(part: number, whole: number): string {
  if (part === 0) return "0%";
  const pct = (part / whole) * 100;
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function decibels(db: number): string {
  return `${db >= 0 ? "+" : ""}${db} dB`;
}

/**
 * What the selected mode can actually do with this library's tags. Almost no library carries
 * ReplayGain on every track, and a mode with no tags behind it is silently identical to Off:
 * the control reads as a working choice while every track takes the fallback gain.
 */
export function describeReplayGainCoverage(
  coverage: ReplayGainCoverage,
  mode: ReplayGainMode,
  fallbackDb: number
): CoverageSummary {
  const { total, withTrackGain, withAlbumGain, withAnyGain } = coverage;
  if (total === 0) {
    return { headline: "No tracks synced yet, so there is nothing to normalize.", detail: "" };
  }

  if (mode === "off") {
    return {
      headline: "Tracks play at their original level.",
      detail:
        withAnyGain === 0
          ? "No track in this library carries ReplayGain tags, so either mode would sound the same as this."
          : `${count(withAnyGain)} of ${count(total)} tracks (${percent(withAnyGain, total)}) carry ReplayGain tags.`,
    };
  }

  const preferredLabel = mode === "album" ? "album gain" : "track gain";
  const otherLabel = mode === "album" ? "track gain" : "album gain";
  const preferred = mode === "album" ? withAlbumGain : withTrackGain;
  const crossFallback = withAnyGain - preferred;
  const untagged = total - withAnyGain;

  if (withAnyGain === 0) {
    return {
      headline: "No track in this library carries ReplayGain tags.",
      detail: `All ${count(total)} play at the fallback gain (${decibels(fallbackDb)}), so this mode sounds the same as Off.`,
    };
  }

  const headline = `${count(preferred)} of ${count(total)} tracks (${percent(preferred, total)}) carry ${preferredLabel}.`;
  const parts: string[] = [];
  if (crossFallback > 0) parts.push(`${count(crossFallback)} more fall back to ${otherLabel}.`);
  parts.push(
    untagged > 0
      ? `${count(untagged)} have no tags and play at the fallback gain (${decibels(fallbackDb)}).`
      : "Every track in this library is normalized."
  );
  return { headline, detail: parts.join(" ") };
}
