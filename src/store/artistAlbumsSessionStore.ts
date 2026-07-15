import { create } from "zustand";

interface ArtistAlbumsSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Sixth domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useArtistAlbums reads SQLite directly instead of react-query; a single
// global tick is used rather than per-artistName keys since bumps are rare
// (artist alias edits) and the query itself is cheap. Low-frequency call
// sites, no debounce needed.
export const useArtistAlbumsSessionStore = create<ArtistAlbumsSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
