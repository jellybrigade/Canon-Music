import { useRef, useState } from "react";
import { usePlayerStore } from "../store/player";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { PlaylistRow } from "./usePlaylists";

export type AppView = "home" | "nowplaying" | "library" | "artists" | "genres" | "years" | "playlists" | "tags" | "unidentified" | "settings";

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

  function navigateTo(v: AppView, select?: { album?: AlbumRow; artist?: ArtistRow }) {
    historyRef.current.push({ view, selectedAlbum, selectedArtist, selectedPlaylist });
    if (v === "nowplaying" && isQueueOpen) toggleQueue();
    setView(v);
    setSelectedAlbum(select?.album ?? null);
    setSelectedArtist(select?.artist ?? null);
    setSelectedPlaylist(null);
  }

  function openAlbum(album: AlbumRow) {
    historyRef.current.push({ view, selectedAlbum, selectedArtist, selectedPlaylist });
    setSelectedAlbum(album);
  }

  function openArtist(artist: ArtistRow) {
    historyRef.current.push({ view, selectedAlbum, selectedArtist, selectedPlaylist });
    setSelectedArtist(artist);
  }

  function goBack() {
    const prev = historyRef.current.pop();
    if (!prev) {
      setSelectedAlbum(null);
      setSelectedArtist(null);
      setSelectedPlaylist(null);
      return;
    }
    setView(prev.view);
    setSelectedAlbum(prev.selectedAlbum);
    setSelectedArtist(prev.selectedArtist);
    setSelectedPlaylist(prev.selectedPlaylist);
  }

  function peekBack(): AppView | null {
    const entry = historyRef.current[historyRef.current.length - 1];
    return entry ? entry.view : null;
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
    openAlbum,
    openArtist,
    goBack,
    peekBack,
  };
}
