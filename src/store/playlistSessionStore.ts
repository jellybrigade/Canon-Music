import { create } from "zustand";

interface PlaylistSessionState {
  playlistsTick: number;
  playlistTracksTick: number;
  bumpPlaylists: () => void;
  bumpPlaylistTracks: () => void;
}

// Seventh domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// usePlaylists and usePlaylistTracks read SQLite directly instead of
// react-query; one store covers both since most mutations touch both tables
// together (e.g. adding a track bumps playlist track_count too). Two
// independent ticks so a playlists-only change (rename, custom cover) doesn't
// force every open playlist's track list to refetch.
export const usePlaylistSessionStore = create<PlaylistSessionState>((set) => ({
  playlistsTick: 0,
  playlistTracksTick: 0,
  bumpPlaylists: () => set((s) => ({ playlistsTick: s.playlistsTick + 1 })),
  bumpPlaylistTracks: () => set((s) => ({ playlistTracksTick: s.playlistTracksTick + 1 })),
}));
