import { create } from "zustand";

interface AllTracksSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  cachedKey: string | undefined;
  setRows: (rows: unknown[], tick: number, key?: string) => void;
}

// useAllTracks reads SQLite directly (RQ -> local-mirror migration, psysonic pattern);
// sync bumps this tick to refetch. Caches rows by tick so remounts reuse them, not flash empty.
export const useAllTracksSessionStore = create<AllTracksSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  rows: undefined,
  cachedTick: -1,
  cachedKey: undefined,
  setRows: (rows, tick, key) => set({ rows, cachedTick: tick, cachedKey: key }),
}));
