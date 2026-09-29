import { create } from "zustand";

interface ArtistBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  cachedKey: string | undefined;
  setRows: (rows: unknown[], tick: number, key?: string) => void;
}

// Tick-driven SQLite reads for useArtists, caching rows per tick. Bumps are debounced
// because every enriching artist card bumps, and a bare tick doesn't dedupe refetches.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useArtistBrowseSessionStore = create<ArtistBrowseSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      set((s) => ({ refreshTick: s.refreshTick + 1 }));
    }, 400);
  },
  rows: undefined,
  cachedTick: -1,
  cachedKey: undefined,
  setRows: (rows, tick, key) => set({ rows, cachedTick: tick, cachedKey: key }),
}));
