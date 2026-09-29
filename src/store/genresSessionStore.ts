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

// Shared by useGenres and useRecentGenres (RQ -> local-mirror migration), like the loved
// domain shares one store across tracks/albums. Rows cached by tick so consumers reuse one fetch.
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
