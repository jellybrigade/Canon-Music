import { seededShuffle } from "./shuffle";
import type { AlbumRow } from "../types/library";

export interface ForYouGroup {
  /** Category key, not the label: two custom categories can share a kicker. */
  key: string;
  kicker: string;
  albums: AlbumRow[];
}

export type ForYouCustomFilter =
  | { type: "decade"; decade: number }
  | { type: "artist"; artist: string };

export interface ForYouCategoryConfig {
  key: string;
  kicker: string;
  enabled: boolean;
  customFilter?: ForYouCustomFilter;
}

export const FOR_YOU_PER_TAB_MIN = 1;
export const FOR_YOU_PER_TAB_MAX = 24;
export const FOR_YOU_PER_TAB_DEFAULT = 6;
/** A stored count off this list (hand-edited, or from an older build) is still honoured by the parse. */
export const FOR_YOU_PER_TAB_CHOICES = [4, 6, 8, 12, 18, 24];

export function parseForYouPerTab(raw: string): number {
  if (raw.trim() === "") return FOR_YOU_PER_TAB_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return FOR_YOU_PER_TAB_DEFAULT;
  return Math.min(FOR_YOU_PER_TAB_MAX, Math.max(FOR_YOU_PER_TAB_MIN, Math.round(value)));
}

/** Tabs claim albums in config order, so an album shown under one tab is skipped by every later tab. */
export function buildForYouGroups(
  spotlightIds: string[],
  sources: Record<string, AlbumRow[]>,
  config: ForYouCategoryConfig[],
  seed: number,
  perTab: number,
): ForYouGroup[] {
  const groups: ForYouGroup[] = [];
  const used = new Set<string>(spotlightIds);

  let catIdx = 0;
  const groupFrom = (key: string, kicker: string, source: AlbumRow[]) => {
    const withArt = source.filter(a => a.artwork_url);
    if (withArt.length === 0) { catIdx++; return; }
    // Shuffle with a per-category seed so different categories pick independently.
    const shuffled = seededShuffle(withArt, seed * 31 + catIdx);
    catIdx++;
    const albums: AlbumRow[] = [];
    for (const a of shuffled) {
      if (albums.length >= perTab) break;
      if (used.has(a.id)) continue;
      used.add(a.id);
      albums.push(a);
    }
    if (albums.length > 0) groups.push({ key, kicker, albums });
  };

  for (const cat of config) {
    if (!cat.enabled) continue;
    const source = sources[cat.key] ?? [];
    groupFrom(cat.key, cat.kicker, source);
  }

  return groups;
}
