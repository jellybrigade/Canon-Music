import { create } from "zustand";

interface TrackListSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Tick-driven SQLite reads for useTracks. Few bump sites, so no debounce.
export const useTrackListSessionStore = create<TrackListSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
