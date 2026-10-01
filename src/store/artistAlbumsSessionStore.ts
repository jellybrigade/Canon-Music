import { create } from "zustand";

interface ArtistAlbumsSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// useArtistAlbums reads SQLite directly (RQ -> local-mirror migration); one global tick
// rather than per-artistName keys, since bumps (artist alias edits) are rare and cheap.
export const useArtistAlbumsSessionStore = create<ArtistAlbumsSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
