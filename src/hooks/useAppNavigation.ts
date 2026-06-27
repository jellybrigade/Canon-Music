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

type LocationState = {
  album?: AlbumRow;
  artist?: ArtistRow;
  playlist?: PlaylistRow;
  fromView?: AppView;
};

export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);

  const pathname = location.pathname;
  const locationState = (location.state ?? {}) as LocationState;

  const view: AppView = (() => {
    for (const [v, p] of Object.entries(VIEW_TO_PATH)) {
      if (pathname === p) return v as AppView;
    }
    // For detail routes: restore the originating view from state
    if (locationState.fromView) return locationState.fromView;
    if (pathname.startsWith("/playlist/")) return "playlists";
    return "library";
  })();

  function navigateTo(v: AppView, select?: { album?: AlbumRow; artist?: ArtistRow }) {
    if (v === "nowplaying" && isQueueOpen) toggleQueue();
    if (select?.album) {
      navigate(albumPath(select.album.id), { state: { album: select.album, fromView: view } });
    } else if (select?.artist) {
      navigate(artistPath(select.artist.name), { state: { artist: select.artist, fromView: view } });
    } else {
      navigate(VIEW_TO_PATH[v]);
    }
  }

  function openAlbum(album: AlbumRow) {
    navigate(albumPath(album.id), { state: { album, fromView: view } });
  }

  function openArtist(artist: ArtistRow) {
    navigate(artistPath(artist.name), { state: { artist, fromView: view } });
  }

  function openPlaylist(playlist: PlaylistRow) {
    navigate(playlistPath(playlist.id), { state: { playlist, fromView: "playlists" } });
  }

  function goBack() {
    navigate(-1);
  }

  function peekBack(): AppView | null {
    return null;
  }

  return {
    view,
    navigateTo,
    openAlbum,
    openArtist,
    openPlaylist,
    goBack,
    peekBack,
  };
}
