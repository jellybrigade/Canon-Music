import { useCallback, useMemo } from "react";
import { useBoolSetting, useSetting } from "./useSetting";

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

/** Extracts the text inside trailing parens, e.g. "Album (Deluxe)" → "Deluxe". Returns null if no parens suffix. */
export function extractSuffix(name: string): string | null {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m || !m[1]!.trim()) return null;
  return m[2]!.trim();
}

export function stripAlbumSuffix(name: string, userAllowlist: string[] = []): string {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return name;
  const inner = m[2]!.trim();
  const stripped = m[1]!.trim();
  if (stripped.length === 0) return name;
  const matchesBuiltin = STRIP_PATTERNS.some((re) => re.test(inner));
  const matchesUser = userAllowlist.some((s) => s.toLowerCase() === inner.toLowerCase());
  return (matchesBuiltin || matchesUser) ? stripped : name;
}

/** Manages the user-defined suffix allowlist stored in settings. */
export function useAlbumSuffixAllowlist(): [string[], (s: string) => Promise<void>, (s: string) => Promise<void>] {
  const [raw, setRaw] = useSetting("display.album_suffix_allowlist", "[]");
  const list = useMemo(() => {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }, [raw]);
  const add = useCallback(async (suffix: string) => {
    if (list.some((s) => s.toLowerCase() === suffix.toLowerCase())) return;
    await setRaw(JSON.stringify([...list, suffix]));
  }, [list, setRaw]);
  const remove = useCallback(async (suffix: string) => {
    await setRaw(JSON.stringify(list.filter((s) => s.toLowerCase() !== suffix.toLowerCase())));
  }, [list, setRaw]);
  return [list, add, remove];
}

/** Returns a display transform: identity when suffixes shown, stripper when hidden. */
export function useAlbumDisplayName(): (name: string) => string {
  const [show] = useBoolSetting("display.show_album_suffixes", true);
  const [userAllowlist] = useAlbumSuffixAllowlist();
  return show ? (n) => n : (n) => stripAlbumSuffix(n, userAllowlist);
}
