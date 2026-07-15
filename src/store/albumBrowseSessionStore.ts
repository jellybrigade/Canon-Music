import { create } from "zustand";

interface AlbumBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Pilot for the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useAlbums reads SQLite directly instead of react-query; sync/mutation call
// sites bump this tick to trigger a refetch instead of queryClient.invalidateQueries.
export const useAlbumBrowseSessionStore = create<AlbumBrowseSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
