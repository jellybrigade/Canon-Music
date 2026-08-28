import { useCallback, useEffect, useRef } from "react";
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

/**
 * `dismissOverlays` runs on the *intent* to go somewhere, not on the pathname landing
 * somewhere new. The overlays it dismisses (search, command palette) are not URL-backed, so
 * asking for the route already open - the active sidebar item, the album whose page is
 * showing, Alt+ArrowLeft at the first history entry - moves the router nowhere and leaves
 * them painted over the answer, which reads as the click doing nothing. Dismissing here
 * rather than at each source is what stops a navigation added later from missing it; see
 * known-issues.md, "State deciding which subtree renders, but absent from the URL".
 *
 * The dismissal is urgent, not a transition, though React Router 7 commits its own location
 * update as one. Routes are `lazy` under the same already-mounted Suspense boundary the overlay
 * renders in, and React keeps a boundary's committed content while a transition suspends, so a
 * matched priority holds the dismissal until the destination chunk resolves - the overlay stays
 * over the click that asked for it. Urgent, the overlay goes at once and the route the user came
 * from stays painted for the frame or two until the transition lands.
 */
export function useAppNavigation(dismissOverlays: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  // Read through a ref: callers pass a fresh closure per render, and the window listeners
  // below must not be torn down and re-armed for it.
  const dismissRef = useRef(dismissOverlays);
  dismissRef.current = dismissOverlays;
  const dismiss = useCallback(() => dismissRef.current(), []);
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
    dismiss();
  }

  function openAlbum(album: AlbumRow) {
    navigate(albumPath(album.id));
    dismiss();
  }

  function openArtist(artist: ArtistRow | string) {
    const name = typeof artist === "string" ? artist : artist.name;
    navigate(artistPath(name));
    dismiss();
  }

  function openPlaylist(playlist: PlaylistRow) {
    navigate(playlistPath(playlist.id));
    dismiss();
  }

  function goBack() {
    navigate(-1);
    dismiss();
  }

  // Back and forward for the whole app. The only other way to go back is the
  // per-detail-page back button, and there was no way to go forward at all.
  // Alt+Arrow is the desktop convention and is free here: useGlobalShortcuts
  // bails on altKey, so its left/right seek bindings can't collide. Mouse
  // buttons 3 and 4 are the thumb buttons; WebKit does not act on them itself.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      navigate(e.key === "ArrowLeft" ? -1 : 1);
      dismiss();
    }
    function onMouseUp(e: MouseEvent) {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      navigate(e.button === 3 ? -1 : 1);
      dismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [navigate, dismiss]);

  return {
    view,
    // Exposed alongside `view` because `view` is deliberately coarse: detail routes
    // fold into their browse view (/album/:id -> library), which is too broad for
    // deciding whether a browse list's data actually needs loading.
    pathname,
    navigateTo,
    openAlbum,
    openArtist,
    openPlaylist,
    goBack,
  };
}
