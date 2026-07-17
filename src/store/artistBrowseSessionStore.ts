import { create } from "zustand";

interface ArtistBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  cachedKey: string | undefined;
  setRows: (rows: unknown[], tick: number, key?: string) => void;
}

// Second domain in the RQ -> local-SQLite-mirror migration (psysonic pattern),
// following albumBrowseSessionStore's pilot. useArtists reads SQLite directly
// instead of react-query; sync/mutation call sites bump this tick to trigger
// a refetch instead of queryClient.invalidateQueries. Also caches the fetched
// rows (keyed by tick) so re-mounting a view reuses them instead of flashing empty.
//
// bumpRefresh is called once per artist card that finishes enrichment
// (ArtistGrid renders one useEnrichArtist per visible card), so a first-visit
// burst of dozens of stale artists enriching at once could fire dozens of
// concurrent full-table useArtists() refetches back to back -- unlike RQ's
// invalidateQueries, a plain tick counter doesn't dedupe. Debounce so a burst
// of bumps within the window collapses into a single refetch.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useArtistBrowseSessionStore = create<ArtistBrowseSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      set((s) => ({ refreshTick: s.refreshTick + 1 }));
    }, 400);
  },
  rows: undefined,
  cachedTick: -1,
  cachedKey: undefined,
  setRows: (rows, tick, key) => set({ rows, cachedTick: tick, cachedKey: key }),
}));
