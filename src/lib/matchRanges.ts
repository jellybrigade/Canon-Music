export interface MatchRange {
  start: number;
  end: number;
}

/** Where any of the tokens occurs in the text, case-insensitive, as sorted non-overlapping ranges. */
export function matchRanges(text: string, tokens: readonly string[]): MatchRange[] {
  const lower = text.toLowerCase();
  const hits: MatchRange[] = [];
  for (const token of tokens) {
    const needle = token.toLowerCase();
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
      hits.push({ start: at, end: at + needle.length });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  return merged;
}
