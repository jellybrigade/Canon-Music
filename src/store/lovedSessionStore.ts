import { create } from "zustand";

export interface LovedSets {
  trackIds: Set<string>;
  albumIds: Set<string>;
  trackAlbumIds: Set<string>;
}

interface LovedSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  sets: LovedSets | undefined;
  cachedTick: number;
  setSets: (sets: LovedSets, tick: number) => void;
}

// Tick-driven SQLite reads for useLoved, cached per tick because ~8 components mount it.
// Sets are safe here: React Query isn't in this path.
export const useLovedSessionStore = create<LovedSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  sets: undefined,
  cachedTick: -1,
  // Reads fire per tick and can resolve out of order; dropping results older than what's
  // cached stops a slow stale read from clobbering fresher sets and sticking forever.
  setSets: (sets, tick) =>
    set((s) => (tick < s.cachedTick ? s : { sets, cachedTick: tick })),
}));
