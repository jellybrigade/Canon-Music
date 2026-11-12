import type { AlbumRow } from "../types/library";
import { seededShuffle } from "./shuffle";

export interface ForYouGroup {
  /** Category key, not the label: two custom categories can share a kicker. */
  key: string;
  kicker: string;
  albums: AlbumRow[];
  isLocked: boolean;
}

export type ForYouCustomFilter = { type: "decade"; decade: number } | { type: "artist"; artist: string };

export interface ForYouCategoryConfig {
  key: string;
  kicker: string;
  enabled: boolean;
  customFilter?: ForYouCustomFilter;
}

export const FOR_YOU_PER_TAB_MIN = 1;
export const FOR_YOU_PER_TAB_MAX = 24;
export const FOR_YOU_PER_TAB_DEFAULT = 6;

export function parseForYouPerTab(raw: string): number {
  if (raw.trim() === "") return FOR_YOU_PER_TAB_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return FOR_YOU_PER_TAB_DEFAULT;
  return Math.min(FOR_YOU_PER_TAB_MAX, Math.max(FOR_YOU_PER_TAB_MIN, Math.round(value)));
}

/** Each tab's shuffled albums, picked once per seed so later data changes never reshuffle them. */
export type ForYouOrders = Record<string, AlbumRow[]>;

export interface ForYouPickInput {
  sources: Record<string, AlbumRow[]>;
  config: ForYouCategoryConfig[];
  seed: number;
  excludedIds: string[];
}

/** Picks only tabs with no order yet; returns `previous` itself when there is nothing new to pick. */
export function pickForYouOrders(previous: ForYouOrders, input: ForYouPickInput): ForYouOrders {
  const excluded = new Set(input.excludedIds);
  let next = previous;
  input.config.forEach((cat, index) => {
    if (next[cat.key]) return;
    const candidates = (input.sources[cat.key] ?? []).filter((a) => a.artwork_url && !excluded.has(a.id));
    if (candidates.length === 0) return;
    if (next === previous) next = { ...previous };
    // Per-category seed so different categories pick independently.
    next[cat.key] = seededShuffle(candidates, input.seed * 31 + index);
  });
  return next;
}

/** Album ids per tab key that Refresh and relaunch leave in place. */
export type ForYouLocks = Record<string, string[]>;

/** Per server: locked ids name that server's albums. */
export function forYouLocksKey(serverId: string): string {
  return `server.for_you_locked.${serverId}`;
}

export function parseForYouLocks(raw: string): ForYouLocks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const locks: ForYouLocks = {};
  for (const [key, ids] of Object.entries(parsed)) {
    if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) locks[key] = ids;
  }
  return locks;
}

export interface ForYouBuildInput {
  orders: ForYouOrders;
  sources: Record<string, AlbumRow[]>;
  /** Every album, so a locked one still shows after it leaves its tab's source; once known, a pick gone from it is dropped. */
  library?: AlbumRow[];
  config: ForYouCategoryConfig[];
  perTab: number;
  locks?: ForYouLocks;
  /** Shown elsewhere on Home (the spotlight), read live: it can change after the picks are frozen. */
  excludedIds?: string[];
}

/** Locked albums are claimed first; then tabs claim in config order, so an album shown under one tab is skipped by every later tab. */
export function buildForYouGroups({
  orders,
  sources,
  library,
  config,
  perTab,
  locks = {},
  excludedIds = [],
}: ForYouBuildInput): ForYouGroup[] {
  const latest = new Map<string, AlbumRow>();
  for (const album of library ?? []) latest.set(album.id, album);
  for (const source of Object.values(sources)) for (const album of source) latest.set(album.id, album);
  // A frozen pick shows its current row; it is dropped once the library no longer has it, or it lost its artwork.
  const current = (picked: AlbumRow): AlbumRow | null => {
    const row = latest.get(picked.id) ?? (library === undefined ? picked : null);
    return row?.artwork_url ? row : null;
  };

  const enabled = config.filter((cat) => cat.enabled);
  const used = new Set<string>(excludedIds);
  const lockedRows = new Map<string, AlbumRow[]>();
  for (const cat of enabled) {
    const ids = locks[cat.key];
    if (!ids) continue;
    const rows = ids.flatMap((id) => (used.has(id) ? [] : (latest.get(id) ?? []))).slice(0, perTab);
    if (rows.length === 0) continue;
    for (const row of rows) used.add(row.id);
    lockedRows.set(cat.key, rows);
  }

  const groups: ForYouGroup[] = [];
  for (const cat of enabled) {
    const locked = lockedRows.get(cat.key);
    const albums: AlbumRow[] = locked ?? [];
    if (!locked) {
      for (const picked of orders[cat.key] ?? []) {
        if (albums.length >= perTab) break;
        if (used.has(picked.id)) continue;
        const row = current(picked);
        if (row === null) continue;
        used.add(picked.id);
        albums.push(row);
      }
    }
    if (albums.length > 0) groups.push({ key: cat.key, kicker: cat.kicker, albums, isLocked: locked !== undefined });
  }
  return groups;
}
