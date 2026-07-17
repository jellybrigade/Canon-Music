import { create } from "zustand";

interface AllTracksSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  cachedKey: string | undefined;
  setRows: (rows: unknown[], tick: number, key?: string) => void;
}

// Fourth domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useAllTracks reads SQLite directly instead of react-query; sync invalidation
// bumps this tick to trigger a refetch. Single low-frequency call site
// (library sync finishing), no debounce needed. Also caches the fetched rows
// (keyed by tick) so re-mounting a view reuses them instead of flashing empty.
export const useAllTracksSessionStore = create<AllTracksSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  rows: undefined,
  cachedTick: -1,
  cachedKey: undefined,
  setRows: (rows, tick, key) => set({ rows, cachedTick: tick, cachedKey: key }),
}));
