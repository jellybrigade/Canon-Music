import { create } from "zustand";

interface TrackListSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Third domain in the RQ -> local-SQLite-mirror migration (psysonic pattern),
// following albumBrowseSessionStore/artistBrowseSessionStore. useTracks reads
// SQLite directly instead of react-query; mutation call sites bump this tick
// to trigger a refetch instead of queryClient.invalidateQueries.
//
// Only two low-frequency invalidation sites (album-track enrichment finishing,
// manual re-enrich in AlbumDetail) so no debounce needed here unlike the
// artist store's per-card enrichment burst.
export const useTrackListSessionStore = create<TrackListSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
