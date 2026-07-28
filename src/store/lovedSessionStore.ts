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

// Third domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useLoved reads SQLite directly instead of react-query; toggle mutations and
// sync bump this tick to trigger a refetch instead of queryClient.invalidateQueries.
// This also removes the documented RQ Set-in-queryFn footgun (feedback-rq-set-bug.md)
// since react-query no longer sits in front of this data at all - and storing Sets
// here is safe for the same reason, RQ's structuralSharing is not in this path.
// The sets are cached (keyed by tick) because useLoved is mounted by ~8 components
// at once; without this each mount ran its own full read.
export const useLovedSessionStore = create<LovedSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  sets: undefined,
  cachedTick: -1,
  setSets: (sets, tick) => set({ sets, cachedTick: tick }),
}));
