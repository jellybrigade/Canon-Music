import { useBoolSetting } from "./useSetting";

/**
 * Known edition/quality suffixes that are noise, not title identity.
 * Matched case-insensitively against the full content of the trailing parens.
 *
 * To add: match the exact text inside the parens (no outer parens).
 * Patterns support * as a wildcard for variable portions.
 */
const STRIP_PATTERNS: RegExp[] = [
  // Audio quality
  /^\d+-bit\s*[/\\]\s*\d+(\.\d+)?\s*khz$/i,
  /^hi-?res(olution)?$/i,
  /^flac$/i,
  /^(mp3|aac|ogg|opus|wav|aiff?)$/i,

  // Content advisory
  /^clean$/i,
  /^explicit$/i,
  /^radio\s+edit$/i,
  /^censored$/i,
  /^edited$/i,

  // Edition / remaster labels
  /^(deluxe|super\s+deluxe)(\s+edition)?$/i,
  /^expanded(\s+edition)?$/i,
  /^special(\s+edition)?$/i,
  /^limited(\s+edition)?$/i,
  /^collector'?s(\s+edition)?$/i,
  /^anniversary(\s+edition)?$/i,
  /^(\d{2,4}th?\s+)?anniversary(\s+edition)?$/i,
  /^remaster(ed)?(\s+\d{4})?$/i,
  /^(\d{4}\s+)?remaster(ed)?$/i,
  /^reissue$/i,
  /^bonus\s+(tracks?|edition)$/i,
  /^definitive(\s+edition)?$/i,
  /^complete(\s+edition)?$/i,
  /^platinum(\s+edition)?$/i,
  /^gold(\s+edition)?$/i,
  /^individually\s+numbered(\s+set)?$/i,
  /^numbered(\s+(limited\s+)?edition)?$/i,
  /^original\s+(album\s+)?recording$/i,
  /^stereo$/i,
  /^mono$/i,
  /^japanese(\s+edition)?$/i,
  /^import$/i,
];

export function stripAlbumSuffix(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return name;
  const inner = m[2]!.trim();
  const stripped = m[1]!.trim();
  if (stripped.length === 0) return name; // don't strip if nothing remains
  return STRIP_PATTERNS.some((re) => re.test(inner)) ? stripped : name;
}

/** Returns a display transform: identity when suffixes shown, stripper when hidden. */
export function useAlbumDisplayName(): (name: string) => string {
  const [show] = useBoolSetting("display.show_album_suffixes", true);
  return show ? (n) => n : stripAlbumSuffix;
}
