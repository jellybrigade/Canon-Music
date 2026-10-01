import { create } from "zustand";

interface PlaylistSessionState {
  playlistsTick: number;
  playlistTracksTick: number;
  bumpPlaylists: () => void;
  bumpPlaylistTracks: () => void;
  rows: unknown[] | undefined;
  cachedTick: number;
  setRows: (rows: unknown[], tick: number) => void;
}

// usePlaylists and usePlaylistTracks read SQLite directly (RQ -> local-mirror migration);
// one store since most mutations touch both tables, but two ticks so a playlists-only
// change doesn't force every open track list to refetch.
export const usePlaylistSessionStore = create<PlaylistSessionState>((set) => ({
  playlistsTick: 0,
  playlistTracksTick: 0,
  bumpPlaylists: () => set((s) => ({ playlistsTick: s.playlistsTick + 1 })),
  bumpPlaylistTracks: () => set((s) => ({ playlistTracksTick: s.playlistTracksTick + 1 })),
  rows: undefined,
  cachedTick: -1,
  setRows: (rows, tick) => set({ rows, cachedTick: tick }),
}));
