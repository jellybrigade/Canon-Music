import { create } from "zustand";

interface GenresSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Fifth domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// Shared by useGenres and useRecentGenres, mirroring how the loved domain
// shares one store across tracks/albums. Single low-frequency call site
// (library sync finishing), no debounce needed.
export const useGenresSessionStore = create<GenresSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
