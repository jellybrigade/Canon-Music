import { useCallback, useMemo } from "react";
import { useBoolSetting, useSetting } from "./useSetting";

export interface BuiltinPattern {
  id: string;
  label: string;
  pattern: RegExp;
}

export const BUILTIN_PATTERNS: BuiltinPattern[] = [
  // Audio quality
  { id: "audio-bitdepth",  label: "Bit depth / sample rate",       pattern: /^\d+-bit\s*[/\\]\s*\d+(\.\d+)?\s*khz$/i },
  { id: "audio-hires",     label: "Hi-Res / HiResolution",         pattern: /^hi-?res(olution)?$/i },
  { id: "audio-flac",      label: "FLAC",                          pattern: /^flac$/i },
  { id: "audio-format",    label: "Audio format (MP3, AAC, OGG…)", pattern: /^(mp3|aac|ogg|opus|wav|aiff?)$/i },
  // Content advisory
  { id: "advisory-clean",      label: "Clean",      pattern: /^clean$/i },
  { id: "advisory-explicit",   label: "Explicit",   pattern: /^explicit$/i },
  { id: "advisory-radio-edit", label: "Radio Edit", pattern: /^radio\s+edit$/i },
  { id: "advisory-censored",   label: "Censored",   pattern: /^censored$/i },
  { id: "advisory-edited",     label: "Edited",     pattern: /^edited$/i },
  // Edition / remaster labels
  { id: "edition-deluxe",      label: "Deluxe Edition",       pattern: /^(deluxe|super\s+deluxe)(\s+edition)?$/i },
  { id: "edition-expanded",    label: "Expanded Edition",     pattern: /^expanded(\s+edition)?$/i },
  { id: "edition-special",     label: "Special Edition",      pattern: /^special(\s+edition)?$/i },
  { id: "edition-limited",     label: "Limited Edition",      pattern: /^limited(\s+edition)?$/i },
  { id: "edition-collectors",  label: "Collector's Edition",  pattern: /^collector'?s(\s+edition)?$/i },
  { id: "edition-anniversary", label: "Anniversary Edition",  pattern: /^(\d{2,4}th?\s+)?anniversary(\s+edition)?$/i },
  { id: "edition-remastered",  label: "Remastered",           pattern: /^(\d{4}\s+)?remaster(ed)?(\s+\d{4})?$/i },
  { id: "edition-reissue",     label: "Reissue",              pattern: /^reissue$/i },
  { id: "edition-bonus",       label: "Bonus Tracks",         pattern: /^bonus\s+(tracks?|edition)$/i },
  { id: "edition-definitive",  label: "Definitive Edition",   pattern: /^definitive(\s+edition)?$/i },
  { id: "edition-complete",    label: "Complete Edition",     pattern: /^complete(\s+edition)?$/i },
  { id: "edition-platinum",    label: "Platinum Edition",     pattern: /^platinum(\s+edition)?$/i },
  { id: "edition-gold",        label: "Gold Edition",         pattern: /^gold(\s+edition)?$/i },
  { id: "edition-numbered",    label: "Numbered Edition",     pattern: /^(individually\s+numbered(\s+set)?|numbered(\s+(limited\s+)?edition)?)$/i },
  { id: "edition-original",    label: "Original Recording",   pattern: /^original\s+(album\s+)?recording$/i },
  { id: "edition-stereo",      label: "Stereo",               pattern: /^stereo$/i },
  { id: "edition-mono",        label: "Mono",                 pattern: /^mono$/i },
  { id: "edition-japanese",    label: "Japanese Edition",     pattern: /^japanese(\s+edition)?$/i },
  { id: "edition-import",      label: "Import",               pattern: /^import$/i },
];

/** Extracts the text inside trailing parens, e.g. "Album (Deluxe)" → "Deluxe". Returns null if no parens suffix. */
export function extractSuffix(name: string): string | null {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m || !m[1]!.trim()) return null;
  return m[2]!.trim();
}

export function stripAlbumSuffix(
  name: string,
  userAllowlist: string[] = [],
  disabledBuiltinIds: string[] = [],
): string {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return name;
  const inner = m[2]!.trim();
  const stripped = m[1]!.trim();
  if (stripped.length === 0) return name;
  const matchesBuiltin = BUILTIN_PATTERNS
    .filter((p) => !disabledBuiltinIds.includes(p.id))
    .some((p) => p.pattern.test(inner));
  const matchesUser = userAllowlist.some((s) => s.toLowerCase() === inner.toLowerCase());
  return (matchesBuiltin || matchesUser) ? stripped : name;
}

/** Manages the user-defined suffix allowlist stored in settings. */
export function useAlbumSuffixAllowlist(): [
  list: string[],
  add: (s: string) => Promise<void>,
  remove: (s: string) => Promise<void>,
  edit: (old: string, next: string) => Promise<void>,
] {
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
  const edit = useCallback(async (old: string, next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    await setRaw(JSON.stringify(list.map((s) => s.toLowerCase() === old.toLowerCase() ? trimmed : s)));
  }, [list, setRaw]);
  return [list, add, remove, edit];
}

/** Manages the set of disabled built-in pattern IDs stored in settings. */
export function useDisabledBuiltinIds(): [
  disabled: string[],
  disable: (id: string) => Promise<void>,
  enable: (id: string) => Promise<void>,
] {
  const [raw, setRaw] = useSetting("display.album_suffix_disabled", "[]");
  const disabled = useMemo(() => {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }, [raw]);
  const disable = useCallback(async (id: string) => {
    if (disabled.includes(id)) return;
    await setRaw(JSON.stringify([...disabled, id]));
  }, [disabled, setRaw]);
  const enable = useCallback(async (id: string) => {
    await setRaw(JSON.stringify(disabled.filter((d) => d !== id)));
  }, [disabled, setRaw]);
  return [disabled, disable, enable];
}

/** Returns a display transform: identity when suffixes shown, stripper when hidden. */
export function useAlbumDisplayName(): (name: string) => string {
  const [show] = useBoolSetting("display.show_album_suffixes", true);
  const [userAllowlist] = useAlbumSuffixAllowlist();
  const [disabledIds] = useDisabledBuiltinIds();
  return show ? (n) => n : (n) => stripAlbumSuffix(n, userAllowlist, disabledIds);
}
