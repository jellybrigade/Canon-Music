import { create } from "zustand";
import type { AlbumRow } from "../types/library";

// Distinct (sort, genre-filter) result sets to keep; only needs to cover what a user
// flips between within one sync generation, not every filter ever touched.
const MAX_ENTRIES = 8;

interface AlbumBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  cachedTick: number;
  entries: Map<string, AlbumRow[]>;
  getRows: (key: string, tick: number) => AlbumRow[] | undefined;
  setRows: (rows: AlbumRow[], tick: number, key: string) => void;
  setAccent: (albumId: string, accentColor: string) => void;
}

// Tick-driven SQLite reads for useAlbums, caching rows per sort + genre filter so toggling
// back to a visited view doesn't rescan the library.
export const useAlbumBrowseSessionStore = create<AlbumBrowseSessionState>((set, get) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  cachedTick: -1,
  entries: new Map(),

  getRows: (key, tick) => {
    const s = get();
    return s.cachedTick === tick ? s.entries.get(key) : undefined;
  },

  setRows: (rows, tick, key) => {
    const s = get();
    // A tick bump invalidates every cached set at once, not just the one being
    // written - they all came from the same pre-sync library state.
    const entries = s.cachedTick === tick ? new Map(s.entries) : new Map<string, AlbumRow[]>();
    // Re-insert so a repeat write refreshes insertion order, keeping the eviction
    // below least-recently-written rather than arbitrary.
    entries.delete(key);
    entries.set(key, rows);
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    set({ entries, cachedTick: tick });
  },

  // An accent derived after the rows were cached would otherwise stay null in them until the
  // next sync, and every Home visit seeded from the cache would decode the cover again.
  setAccent: (albumId, accentColor) => {
    const entries = new Map<string, AlbumRow[]>();
    let isChanged = false;
    for (const [key, rows] of get().entries) {
      if (!rows.some((row) => row.id === albumId && row.accent_color !== accentColor)) {
        entries.set(key, rows);
        continue;
      }
      entries.set(key, rows.map((row) => (row.id === albumId ? { ...row, accent_color: accentColor } : row)));
      isChanged = true;
    }
    if (isChanged) set({ entries });
  },
}));
