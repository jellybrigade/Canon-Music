import { create } from "zustand";

interface AllTracksSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Fourth domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useAllTracks reads SQLite directly instead of react-query; sync invalidation
// bumps this tick to trigger a refetch. Single low-frequency call site
// (library sync finishing), no debounce needed.
export const useAllTracksSessionStore = create<AllTracksSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
