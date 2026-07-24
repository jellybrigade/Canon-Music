import { useNavigate, useLocation } from "react-router-dom";
import { usePlayerStore } from "../store/player";
import { albumPath, artistPath, playlistPath } from "../lib/routes";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { PlaylistRow } from "./usePlaylists";

export type AppView = "home" | "nowplaying" | "library" | "artists" | "genres" | "years" | "playlists" | "tracks" | "tags" | "unidentified" | "settings";

const VIEW_TO_PATH: Record<AppView, string> = {
  home: "/home",
  nowplaying: "/nowplaying",
  library: "/library",
  artists: "/artists",
  genres: "/genres",
  years: "/years",
  playlists: "/playlists",
  tracks: "/tracks",
  tags: "/tags",
  unidentified: "/unidentified",
  settings: "/settings",
};

export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);

  const pathname = location.pathname;

  // The URL is the sole source of truth for the active view (sidebar highlight).
  // Detail routes map to the browse view they belong under, purely by prefix,
  // no location.state involved (psysonic derives active nav from the URL only).
  const view: AppView = (() => {
    for (const [v, p] of Object.entries(VIEW_TO_PATH)) {
      if (pathname === p) return v as AppView;
    }
    if (pathname.startsWith("/album/")) return "library";
    if (pathname.startsWith("/artist/")) return "artists";
    if (pathname.startsWith("/playlist/")) return "playlists";
    return "library";
  })();

  function navigateTo(v: AppView, select?: { album?: AlbumRow; artist?: ArtistRow }) {
    if (v === "nowplaying" && isQueueOpen) toggleQueue();
    if (select?.album) {
      navigate(albumPath(select.album.id));
    } else if (select?.artist) {
      navigate(artistPath(select.artist.name));
    } else {
      navigate(VIEW_TO_PATH[v]);
    }
  }

  function openAlbum(album: AlbumRow) {
    navigate(albumPath(album.id));
  }

  function openArtist(artist: ArtistRow | string) {
    const name = typeof artist === "string" ? artist : artist.name;
    navigate(artistPath(name));
  }

  function openPlaylist(playlist: PlaylistRow) {
    navigate(playlistPath(playlist.id));
  }

  function goBack() {
    navigate(-1);
  }

  return {
    view,
    navigateTo,
    openAlbum,
    openArtist,
    openPlaylist,
    goBack,
  };
}
