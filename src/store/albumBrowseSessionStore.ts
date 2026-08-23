import { create } from "zustand";

// How many distinct (sort, genre-filter) result sets to keep. The list is fully
// re-fetched whenever the tick bumps, so this only has to cover the sets a user
// flips between within one sync generation: four sorts, plus a few filter
// combinations. Small enough that the memory held is bounded by the largest few
// album lists rather than by the number of filters ever touched.
const MAX_ENTRIES = 8;

interface AlbumBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  cachedTick: number;
  entries: Map<string, unknown[]>;
  getRows: (key: string, tick: number) => unknown[] | undefined;
  setRows: (rows: unknown[], tick: number, key: string) => void;
}

// Pilot for the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useAlbums reads SQLite directly instead of react-query; sync/mutation call
// sites bump this tick to trigger a refetch instead of queryClient.invalidateQueries.
// Also caches the fetched rows (keyed by sort + genre filter) so re-mounting a view,
// or returning to a sort the user already visited, reuses them instead of refetching
// and flashing empty. Keyed rather than single-slot because toggling between two
// sorts, or a filter on and off, otherwise misses every time and pays a full-library
// scan for each toggle.
export const useAlbumBrowseSessionStore = create<AlbumBrowseSessionState>((set, get) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  cachedTick: -1,
  entries: new Map(),

  getRows: (key, tick) => {
    const s = get();
    return s.cachedTick === tick ? s.entries.get(key) : undefined;
  },

  setRows: (rows, tick, key) => {
    const s = get();
    // A tick bump invalidates every cached set at once, not just the one being
    // written - they all came from the same pre-sync library state.
    const entries = s.cachedTick === tick ? new Map(s.entries) : new Map<string, unknown[]>();
    // Re-insert so a repeat write refreshes insertion order, keeping the eviction
    // below least-recently-written rather than arbitrary.
    entries.delete(key);
    entries.set(key, rows);
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    set({ entries, cachedTick: tick });
  },
}));
