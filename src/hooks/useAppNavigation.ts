import { useRef, useState } from "react";
import { usePlayerStore } from "../store/player";
import { useLibraryFiltersStore } from "../store/libraryFilters";
import type { AlbumRow } from "./useAlbums";
import type { ArtistRow } from "./useArtists";
import type { PlaylistRow } from "./usePlaylists";

export type AppView = "home" | "nowplaying" | "library" | "artists" | "genres" | "playlists" | "tags" | "settings";

type NavEntry = {
  view: AppView;
  selectedAlbum: AlbumRow | null;
  selectedArtist: ArtistRow | null;
  selectedPlaylist: PlaylistRow | null;
};

export function useAppNavigation() {
  const [view, setView] = useState<AppView>("home");
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumRow | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<ArtistRow | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistRow | null>(null);

  const historyRef = useRef<NavEntry[]>([]);

  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const setCanonicalIdFilters = useLibraryFiltersStore((s) => s.setCanonicalIdFilters);

  function navigateTo(v: AppView, select?: { album?: AlbumRow; artist?: ArtistRow }) {
    historyRef.current.push({ view, selectedAlbum, selectedArtist, selectedPlaylist });
    if (v === "nowplaying" && isQueueOpen) toggleQueue();
    setView(v);
    setSelectedAlbum(select?.album ?? null);
    setSelectedArtist(select?.artist ?? null);
    setSelectedPlaylist(null);
    setCanonicalIdFilters([]);
  }

  function goBack() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setView(prev.view);
    setSelectedAlbum(prev.selectedAlbum);
    setSelectedArtist(prev.selectedArtist);
    setSelectedPlaylist(prev.selectedPlaylist);
  }

  return {
    view,
    selectedAlbum,
    selectedArtist,
    selectedPlaylist,
    setSelectedAlbum,
    setSelectedArtist,
    setSelectedPlaylist,
    navigateTo,
    goBack,
  };
}
