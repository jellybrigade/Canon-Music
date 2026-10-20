const SECONDS_PER_MINUTE = 60;

/** Shared m:ss formatter for transport rows and track lists. */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A zero is a reading and prints; only a missing value leaves the cell blank.
export function durationCell(seconds: number | null | undefined): string {
  return seconds == null ? "" : formatDuration(seconds);
}

export function bitrateCell(kbps: number | null | undefined): string {
  return kbps == null ? "" : `${kbps}k`;
}

const MIN_TRACK_NUMBER_DIGITS = 2;

// Track rows are separate grids, so every column width must come from the list, never a row's content.
export function trackNumberColumn(trackCount: number): string {
  const digits = Math.max(MIN_TRACK_NUMBER_DIGITS, String(trackCount).length);
  return `calc(${digits}ch + var(--track-number-padding-start) + var(--track-number-padding-end))`;
}

export const DURATION_COLUMN = "4.5rem";
