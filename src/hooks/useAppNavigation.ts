import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useLocation, useNavigationType } from "react-router-dom";
import { usePlayerStore } from "../features/playback/store/player";
import { albumPath, artistPath, playlistPath } from "../lib/routes";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { PlaylistRow } from "../features/playlists/usePlaylists";

export type AppView = "home" | "nowplaying" | "library" | "artists" | "genres" | "years" | "playlists" | "tracks" | "tags" | "unidentified" | "settings" | "search";

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
  search: "/search",
};

/**
 * Runs on navigation intent, not pathname change - the palette isn't in the URL, so
 * navigating to the already-open route would leave it painted. Urgent, not a transition.
 */
export function useAppNavigation(dismissOverlays: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  // Read through a ref: callers pass a fresh closure per render, and the window listeners
  // below must not be torn down and re-armed for it.
  const dismissRef = useRef(dismissOverlays);
  dismissRef.current = dismissOverlays;
  const dismiss = useCallback(() => dismissRef.current(), []);
  // Same reason, for `navigate`: react-router hands back a fresh function on every location
  // change, so naming it in the deps below re-arms the listeners once per navigation.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
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

  // Must not push a duplicate entry for the page already showing (Back would then read as
  // doing nothing) - worst on /search, where `leaveSearch` is `navigate(-1)`. `dismiss` still runs either way.
  function goTo(to: string) {
    if (to !== pathname) navigate(to);
    dismiss();
  }

  function navigateTo(v: AppView, select?: { album?: AlbumRow; artist?: ArtistRow }) {
    if (v === "nowplaying" && isQueueOpen) toggleQueue();
    if (select?.album) {
      goTo(albumPath(select.album.id));
    } else if (select?.artist) {
      goTo(artistPath(select.artist.name));
    } else {
      goTo(VIEW_TO_PATH[v]);
    }
  }

  function openAlbum(album: AlbumRow) {
    goTo(albumPath(album.id));
  }

  function openArtist(artist: ArtistRow | string) {
    const name = typeof artist === "string" ? artist : artist.name;
    goTo(artistPath(name));
  }

  function openPlaylist(playlist: PlaylistRow) {
    goTo(playlistPath(playlist.id));
  }

  function goBack() {
    navigate(-1);
    dismiss();
  }

  // Whether the first history entry is showing. `"default"` is react-router's key for it, but
  // a `replace` (e.g. /search's `?q`) mints a fresh key, so the key is tracked and carried over instead.
  const firstEntryKey = useRef("default");
  const onFirstEntry = useRef(location.key === "default");
  useEffect(() => {
    if (navigationType === "PUSH") onFirstEntry.current = false;
    else if (navigationType === "REPLACE") {
      if (onFirstEntry.current) firstEntryKey.current = location.key;
    } else onFirstEntry.current = location.key === firstEntryKey.current;
  }, [location.key, navigationType]);

  // navigate(-1), not a remembered pathname: a push would ping-pong back to /search on
  // Back. First-entry case (cold mount via the lib.rs reload recovery) replaces instead.
  function leaveSearch() {
    if (onFirstEntry.current) navigate("/home", { replace: true });
    else navigate(-1);
    dismiss();
  }

  // App-wide back/forward: Alt+Arrow and mouse thumb buttons. No text-entry guard, by design:
  // Alt+Arrow is browser back/forward even in fields, and GTK word motion is Ctrl+Arrow.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      navigateRef.current(e.key === "ArrowLeft" ? -1 : 1);
      dismiss();
    }
    function onMouseUp(e: MouseEvent) {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      navigateRef.current(e.button === 3 ? -1 : 1);
      dismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dismiss]);

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
    leaveSearch,
  };
}
