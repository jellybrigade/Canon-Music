const STALENESS_DAYS_DEFAULT = 30;
const STALENESS_DAYS_MIN = 1;

const PLAIN_DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;

/** Blank or unreadable falls back; a legal `0` stays `0`, which `Number(x) || fallback` loses. */
export function parseNumberOr<F>(raw: string | null | undefined, fallback: F): number | F {
  const trimmed = raw?.trim() ?? "";
  // Number() alone also reads "0x10" and "1e3", which no setting or Last.fm count is written as.
  if (!PLAIN_DECIMAL.test(trimmed)) return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : fallback;
}

export function parseIntegerOr<F>(raw: string | null | undefined, fallback: F): number | F {
  const value = parseNumberOr(raw, null);
  return value === null ? fallback : Math.trunc(value);
}

/** A zero-day window marks the whole library stale, so a typed `0` reads as the input's own `min`. */
export function parseStalenessDays(raw: string | null | undefined): number {
  const days = parseNumberOr(raw, STALENESS_DAYS_DEFAULT);
  return days >= 0 ? Math.max(STALENESS_DAYS_MIN, days) : STALENESS_DAYS_DEFAULT;
}
