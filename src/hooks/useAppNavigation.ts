import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useLocation, useNavigationType } from "react-router-dom";
import { usePlayerStore } from "../store/player";
import { albumPath, artistPath, playlistPath } from "../lib/routes";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { PlaylistRow } from "./usePlaylists";

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
 * `dismissOverlays` runs on the *intent* to go somewhere, not on the pathname landing
 * somewhere new. The one overlay it dismisses now (the command palette) is not URL-backed, so
 * asking for the route already open - the active sidebar item, the album whose page is
 * showing, Alt+ArrowLeft at the first history entry - moves the router nowhere and leaves it
 * painted over the answer, which reads as the click doing nothing. Dismissing here rather than
 * at each source is what stops a navigation added later from missing it; see known-issues.md,
 * "State deciding which subtree renders, but absent from the URL". Search used to be the other
 * name on that list; it left the class by becoming the `/search` route below, so `goBack`,
 * Alt+Arrow and the thumb buttons now do one thing (move the router) instead of two (also
 * clearing search state out from under the page the router moved to).
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

  // Asking for the page already showing must not push a second copy of its entry: Back from
  // there returns to the same page, which reads as Back doing nothing. Worst on /search, where
  // `leaveSearch` is `navigate(-1)` - the sidebar item stranded the user in search. Compared on
  // pathname alone, so the sidebar Search item keeps the query already in the box. `dismiss`
  // runs either way: the click meant something even when the router stays put.
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

  // Whether the first history entry - the one with nothing behind it - is the entry showing.
  // `"default"` is react-router's key for it, but a `replace` mints a fresh key and /search
  // writes its own `?q` with `replace`, so one keystroke erased the marker. Followed instead:
  // a push leaves that entry, a replace stays on it (carry the key over), and a pop is back on
  // it exactly when the key matches the one it was last seen under.
  const firstEntryKey = useRef("default");
  const onFirstEntry = useRef(location.key === "default");
  useEffect(() => {
    if (navigationType === "PUSH") onFirstEntry.current = false;
    else if (navigationType === "REPLACE") {
      if (onFirstEntry.current) firstEntryKey.current = location.key;
    } else onFirstEntry.current = location.key === firstEntryKey.current;
  }, [location.key, navigationType]);

  // `navigate(-1)` over a remembered pathname on purpose: it is symmetric with the push that
  // opened search, so it restores the history index and scroll position, where a remembered
  // pathname would push a *new* entry - Back from there would return to /search, an
  // inescapable ping-pong - and is exactly the non-URL navigation state this hook exists to
  // avoid. Nothing to go back to on the first entry, which catches /search as a cold mount,
  // reachable via the web-process-terminated -> reload() recovery in lib.rs. `replace`
  // there so the dead-end /search is not left behind for Forward.
  function leaveSearch() {
    if (onFirstEntry.current) navigate("/home", { replace: true });
    else navigate(-1);
    dismiss();
  }

  // Back and forward for the whole app. The only other way to go back is the
  // per-detail-page back button, and there was no way to go forward at all.
  // Alt+Arrow is the desktop convention and is free here: useGlobalShortcuts
  // bails on altKey, so its left/right seek bindings can't collide. Mouse
  // buttons 3 and 4 are the thumb buttons; WebKit does not act on them itself.
  //
  // Deliberately has no `isTextEntryTarget` guard, unlike every other window-level shortcut
  // that preventDefaults. Alt+Arrow is browser-conventional back/forward and browsers honour
  // it inside text fields; GTK entries bind word-wise motion to Ctrl+Arrow, not Alt+Arrow, so
  // the keystroke is not being taken from the field. Adding the guard here would make Canon
  // the odd one out, not safer.
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
