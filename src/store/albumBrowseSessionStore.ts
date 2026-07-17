import { create } from "zustand";

interface AlbumBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  cachedKey: string | undefined;
  setRows: (rows: unknown[], tick: number, key?: string) => void;
}

// Pilot for the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useAlbums reads SQLite directly instead of react-query; sync/mutation call
// sites bump this tick to trigger a refetch instead of queryClient.invalidateQueries.
// Also caches the fetched rows (keyed by tick + optional discriminator) so
// re-mounting a view reuses them instead of refetching and flashing empty.
export const useAlbumBrowseSessionStore = create<AlbumBrowseSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  rows: undefined,
  cachedTick: -1,
  cachedKey: undefined,
  setRows: (rows, tick, key) => set({ rows, cachedTick: tick, cachedKey: key }),
}));
