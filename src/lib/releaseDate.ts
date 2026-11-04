export interface ReleaseDateParts {
  year?: number;
  month?: number;
  day?: number;
}

function inRange(value: number | undefined, max: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= max;
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, as far as the parts go; zero-padded so text order is date order. */
export function releaseDateText(parts: ReleaseDateParts | undefined): string | null {
  if (!parts || !inRange(parts.year, 9999)) return null;
  const year = String(parts.year).padStart(4, "0");
  if (!inRange(parts.month, 12)) return year;
  const month = `${year}-${String(parts.month).padStart(2, "0")}`;
  if (!inRange(parts.day, 31)) return month;
  return `${month}-${String(parts.day).padStart(2, "0")}`;
}
