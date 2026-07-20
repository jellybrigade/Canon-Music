import { create } from "zustand";

interface ScrollMemoryState {
  positions: Record<string, number>;
  save: (key: string, top: number) => void;
}

// Typed Zustand replacement for the module-level Map that useScrollMemory used
// to hold per-view scrollTop. Reshaped into a store to mirror psysonic's
// store/*BrowseSessionStore scroll-restore pattern. Callers still go through
// useScrollMemory (unchanged API) and read/write this store imperatively via
// getState() so scroll bookkeeping stays render-free.
export const useScrollMemoryStore = create<ScrollMemoryState>((set) => ({
  positions: {},
  save: (key, top) =>
    set((s) => ({ positions: { ...s.positions, [key]: top } })),
}));
