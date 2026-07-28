import { create } from "zustand";

interface GenresSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  setRows: (rows: unknown[], tick: number) => void;
  recentRows: unknown[] | undefined;
  recentCachedTick: number;
  setRecentRows: (rows: unknown[], tick: number) => void;
}

// Fifth domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// Shared by useGenres and useRecentGenres, mirroring how the loved domain
// shares one store across tracks/albums. Single low-frequency call site
// (library sync finishing), no debounce needed. Both hooks also cache their
// fetched rows here (keyed by tick) so remounts and multiple consumers reuse
// one fetch per tick instead of re-querying, same as allTracksSessionStore.
export const useGenresSessionStore = create<GenresSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  rows: undefined,
  cachedTick: -1,
  setRows: (rows, tick) => set({ rows, cachedTick: tick }),
  recentRows: undefined,
  recentCachedTick: -1,
  setRecentRows: (rows, tick) => set({ recentRows: rows, recentCachedTick: tick }),
}));
