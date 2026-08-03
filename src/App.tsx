import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Music, Users, Tag, Settings, ListMusic, Headphones, House, Layers, Calendar, LayoutList, CircleHelp } from "lucide-react";
const Wizard = lazy(() => import("./components/setup/Wizard").then((m) => ({ default: m.Wizard })));
import canonFaviconUrl from "./assets/canon-logo-kit/canon-favicon.svg?url";
import { useServers, useServerWithCredential } from "./hooks/useServer";
import { useAlbums } from "./hooks/useAlbums";
import { useArtists } from "./hooks/useArtists";
import { useAllTracks } from "./hooks/useAllTracks";
import { useGenres } from "./hooks/useGenres";
import { useLoved } from "./hooks/useLoved";
import { useSearch } from "./hooks/useSearch";
import { useBoolSetting, useSetting } from "./hooks/useSetting";
import { usePlaylists } from "./hooks/usePlaylists";
import { useScrobbleFlush } from "./hooks/useScrobbleFlush";
import { useUnmappedTagCount } from "./hooks/useTagMappings";
import { useMediaSession } from "./hooks/useMediaSession";
import { useRadio } from "./hooks/useRadio";
import { useFailedLookupAlbumIds } from "./hooks/useAlbumIdentity";
import { useBackgroundNormalizer } from "./hooks/useBackgroundNormalizer";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useQueueSync } from "./hooks/useQueueSync";
import { useWakeLock } from "./hooks/useWakeLock";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppActivityTracking } from "./hooks/useAppActivityTracking";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useLibrarySync } from "./hooks/useLibrarySync";
import { useCoverCachePopulator } from "./hooks/useCoverCache";
import { useNowPlayingPrefetch } from "./hooks/useNowPlayingPrefetch";
import { usePlayerStore } from "./store/player";
import { useTagsStore } from "./store/tags";
import { useLibraryFiltersStore } from "./store/libraryFilters";
import type { RadioMode, CurrentTrack } from "./store/player";
import { extractAccent } from "./lib/artColor";
import { checkForUpdate } from "./lib/updater";
import { fetchRemoteNotice, type RemoteNotice } from "./lib/notice";
import { getCoverArtUrl, getStreamUrl, initCoverServer, setStreamMaxBitrate, updateCoverProxyConfig } from "./lib/navidrome";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { stripServerPrefix } from "./utils/ids";
import { getDb } from "./db";
import type { Update } from "@tauri-apps/plugin-updater";
import type { AlbumRow, AlbumSort, ArtistRow } from "./types/library";
import { AppShell } from "./app/AppShell";
import type { AppViewProps, NavItem } from "./app/AppRoutes";
import "./styles/tokens.css";
import "./styles/library.css";
import "./styles/base.css";
import "./App.css";

export default function App() {
  useWakeLock();
  useAppActivityTracking();
  useRadio();
  useBackgroundNormalizer();
  useNowPlayingPrefetch();

  const loadSettings = usePlayerStore((s) => s.loadSettings);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const setStreamUrlFor = usePlayerStore((s) => s.setStreamUrlFor);
  const setAccentColor = usePlayerStore((s) => s.setAccentColor);

  const enrichmentPending = useTagsStore((s) => s.enrichmentPending);
  const pullProgress = useTagsStore((s) => s.pullProgress);
  const metaBarVisible = !!(enrichmentPending || pullProgress);

  const canonicalIdFilters = useLibraryFiltersStore((s) => s.canonicalIdFilters);
  const lovedOnly = useLibraryFiltersStore((s) => s.lovedOnly);
  const yearFromInput = useLibraryFiltersStore((s) => s.yearFromInput);
  const yearToInput = useLibraryFiltersStore((s) => s.yearToInput);
  const setCanonicalIdFilters = useLibraryFiltersStore((s) => s.setCanonicalIdFilters);
  const toggleCanonicalIdFilter = useLibraryFiltersStore((s) => s.toggleCanonicalIdFilter);
  const toggleLovedOnly = useLibraryFiltersStore((s) => s.toggleLovedOnly);
  const setYearFromInput = useLibraryFiltersStore((s) => s.setYearFromInput);
  const setYearToInput = useLibraryFiltersStore((s) => s.setYearToInput);

  const {
    view,
    pathname,
    navigateTo,
    openAlbum,
    openArtist,
    openPlaylist,
    goBack,
  } = useAppNavigation();

  const [sidebarExpanded, setSidebarExpanded] = useBoolSetting("sidebar.expanded", false);
  const { liveWidth: sidebarLiveWidth, savedWidth: sidebarWidth, handleMouseDown: handleSidebarResizeMouseDown } = useSidebarResize({
    direction: "ltr",
    min: 52,
    max: 400,
    saveMin: 130,
    settingKey: "sidebar.width",
    defaultWidth: 180,
    onCollapse: () => void setSidebarExpanded(false),
  });

  const queryClient = useQueryClient();
  const { data: servers, isLoading: serversLoading, error: serversError, refetch: refetchServers } = useServers();
  const server = servers?.[0];
  const { data: serverWithCred, error: credError } = useServerWithCredential(server?.id);
  // Needs the credential to build a full-size artwork URL for the OS now-playing panel,
  // so it is mounted here rather than at the top with the other playback hooks.
  useMediaSession(serverWithCred);

  const { syncStatus, syncError, syncProgress, lastSyncedAt, runSync } = useLibrarySync(server, queryClient);
  useCoverCachePopulator(serverWithCred ?? undefined);

  useGlobalShortcuts(serverWithCred);
  useQueueSync(serverWithCred);
  useScrobbleFlush(serverWithCred);

  const [rawSort, setSort] = useSetting("library_sort", "artist");
  const sort = (["artist", "alphabetical", "year", "recently_added"].includes(rawSort)
    ? rawSort
    : "artist") as AlbumSort;

  // These four feed exactly one route each (see AppRoutes), so they are gated on the
  // pathname rather than loaded for every view. Gating skips the fetch only - each
  // hook keeps its last rows and its session-store seed, so returning to the route
  // still paints immediately. `pathname` not `view`: view folds /album/:id into
  // "library", which would drag the whole album list into every album detail page.
  const { data: albums } = useAlbums(sort, canonicalIdFilters, pathname === "/library");
  const { data: artists } = useArtists(pathname === "/artists");
  const { data: allTracks, isLoading: allTracksLoading, error: allTracksError } = useAllTracks(pathname === "/tracks");
  const { data: genres } = useGenres(pathname === "/library");
  // Ungated: one cheap shared invoke, and lovedAlbumIds feeds the visibleAlbums memo.
  const { lovedAlbumIds } = useLoved();
  const { data: playlists, createPlaylist, createSmartPlaylist, addAlbumToPlaylist, deletePlaylist, renamePlaylist, setCustomCover, refreshSmartPlaylist, updateSmartPlaylistRules } = usePlaylists();
  // Scalar count for the sidebar badge. The full tag vocabulary is fetched only inside
  // the lazily-loaded Tags route, which is where the rows are actually used.
  const { data: unmappedCountRaw } = useUnmappedTagCount();
  const unmappedCount = unmappedCountRaw ?? 0;
  const [hideTagBadge, setHideTagBadge] = useBoolSetting("ui.hide_tag_badge", false);
  const { data: failedLookupIds } = useFailedLookupAlbumIds();
  const unidentifiedCount = failedLookupIds?.length ?? 0;
  const [albumsPaginated, setAlbumsPaginated] = useBoolSetting("albums.pagination", false);

  const visibleAlbums = useMemo(() => {
    if (albums === undefined) return [];
    const yearFrom = yearFromInput ? parseInt(yearFromInput, 10) : null;
    const yearTo = yearToInput ? parseInt(yearToInput, 10) : null;
    let result = lovedOnly ? albums.filter((a) => lovedAlbumIds.has(a.id)) : albums;
    if (yearFrom != null && !isNaN(yearFrom)) result = result.filter((a) => (a.year ?? 0) >= yearFrom);
    if (yearTo != null && !isNaN(yearTo)) result = result.filter((a) => (a.year ?? 9999) <= yearTo);
    return result;
  }, [albums, lovedOnly, lovedAlbumIds, yearFromInput, yearToInput]);

  const [filterSidebarOpen, setFilterSidebarOpen] = useBoolSetting("filter_sidebar_open", true);

  const [searchRaw, setSearchRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: searchResults, isError: searchError } = useSearch(searchQuery, server?.id);

  const [homeSearchRaw, setHomeSearchRaw] = useState("");
  const [homeSearchQuery, setHomeSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setHomeSearchQuery(homeSearchRaw), 200);
    return () => clearTimeout(t);
  }, [homeSearchRaw]);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [crashReport, setCrashReport] = useState<string | null>(null);
  useEffect(() => {
    void invoke<string | null>("take_crash_report")
      .then((report) => {
        if (report) {
          setCrashReport(report);
          setFeedbackOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<RemoteNotice | null>(null);
  const [lastSeenNoticeId, setLastSeenNoticeId] = useSetting("notice.last_seen_id", "");
  useEffect(() => {
    void fetchRemoteNotice().then((n) => {
      if (n && n.id !== lastSeenNoticeId) setRemoteNotice(n);
    });
  }, [lastSeenNoticeId]);
  const [autoCheckUpdates] = useBoolSetting("updates.auto_check", false);
  const [autoCheckIntervalMin] = useSetting("updates.auto_check_interval_min", "60");
  const [streamMaxBitrate] = useSetting("stream.max_bitrate", "0");
  useEffect(() => { setStreamMaxBitrate(parseInt(streamMaxBitrate, 10)); }, [streamMaxBitrate]);
  useEffect(() => {
    void checkForUpdate().then((u) => { if (u) setPendingUpdate(u); });
  }, []);
  useEffect(() => {
    if (!autoCheckUpdates) return;
    const ms = Math.max(10, parseInt(autoCheckIntervalMin, 10) || 60) * 60 * 1000;
    const id = setInterval(() => {
      void checkForUpdate().then((u) => { if (u) setPendingUpdate(u); });
    }, ms);
    return () => clearInterval(id);
  }, [autoCheckUpdates, autoCheckIntervalMin]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchRaw(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(value), 200);
  }, []);

  const clearSearch = useCallback(() => {
    // Cancel the pending debounce first. Without this, clearing within 200ms of
    // the last keystroke lets the timer fire afterwards and set searchQuery back,
    // which re-opens the search view for a query the now-empty input doesn't show.
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    setSearchRaw("");
    setSearchQuery("");
    setSearchOpen(false);
    searchInputRef.current?.blur();
  }, []);

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
      }
      if (e.key === "Escape" && (searchRaw || searchOpen)) {
        clearSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchRaw, searchOpen, clearSearch]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  // Cover art proxy: push credentials to Rust first, then enable proxy URLs only after config is confirmed.
  // Sequenced in one effect to prevent a window where proxy URLs are returned but the Rust config is still None.
  useEffect(() => {
    if (!serverWithCred) return;
    void (async () => {
      try {
        await updateCoverProxyConfig(
          serverWithCred.server.url,
          serverWithCred.server.username,
          serverWithCred.credential
        );
        initCoverServer();
      } catch {
        // proxy unavailable; getCoverArtUrl falls back to direct Navidrome URL
      }
    })();
  }, [serverWithCred]);

  // Tray: initialize visibility and close-to-tray from settings, then keep menu in sync
  const [showTrayIcon] = useBoolSetting("tray.show_icon", false);
  const [closeToTray] = useBoolSetting("tray.close_to_tray", false);
  useEffect(() => {
    void invoke("tray_set_visible", { visible: showTrayIcon }).catch(() => {});
  }, [showTrayIcon]);
  useEffect(() => {
    void invoke("tray_set_close_to_tray", { enabled: closeToTray }).catch(() => {});
  }, [closeToTray]);
  useEffect(() => {
    // Rebuilding the tray menu allocates a fresh Menu and seven items on the Rust side,
    // so skip the round trip entirely while the icon is hidden (the default).
    if (!showTrayIcon) return;
    const title = currentTrack
      ? `${currentTrack.title}${currentTrack.artist ? ` - ${currentTrack.artist}` : ""}`
      : "";
    void invoke("tray_update", { title, isPlaying }).catch(() => {});
  }, [showTrayIcon, currentTrack?.id, isPlaying]);

  // Tray actions: play_pause and next forwarded to player store
  useEffect(() => {
    const p = listen<string>("tray-action", (e) => {
      const store = usePlayerStore.getState();
      if (e.payload === "play_pause") {
        if (store.isPlaying) store.pause(); else store.resume();
      } else if (e.payload === "next") {
        void store.next();
      }
    });
    return () => { void p.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    setStreamUrlFor((track) => {
      const navTrackId = track.id.slice(srv.id.length + 1);
      return getStreamUrl(srv.url, srv.username, credential, navTrackId);
    });
  }, [serverWithCred, setStreamUrlFor]);

  useEffect(() => {
    const artUrl = currentTrack?.coverArtUrl ?? null;
    if (!artUrl) {
      setAccentColor(null);
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-hover');
      document.documentElement.style.removeProperty('--accent-subtle');
      return;
    }
    let cancelled = false;
    void extractAccent(artUrl).then((color) => {
      if (cancelled) return;
      setAccentColor(color);
      if (color) {
        document.documentElement.style.setProperty('--accent', color);
        document.documentElement.style.setProperty('--accent-hover', `color-mix(in oklab, ${color} 85%, black)`);
        // parse rgb(...) to build subtle
        const m = color.match(/\d+/g);
        if (m) {
          document.documentElement.style.setProperty('--accent-subtle', `rgba(${m[0]}, ${m[1]}, ${m[2]}, 0.18)`);
        }
      }
    });
    return () => { cancelled = true; };
  }, [currentTrack?.coverArtUrl, setAccentColor]);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) return;
    if (currentTrack?.coverArtUrl) {
      link.href = currentTrack.coverArtUrl;
    } else {
      link.href = canonFaviconUrl;
    }
  }, [currentTrack?.coverArtUrl]);

  useEffect(() => {
    if (!currentTrack) { document.title = "Canon"; return; }
    const parts = [currentTrack.artist, currentTrack.title].filter(Boolean);
    document.title = parts.length > 0 ? `${parts.join(" - ")} · Canon` : "Canon";
  }, [currentTrack?.title, currentTrack?.artist]);

  async function handlePlayTrack(trackId: string) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = {
      id: string; title: string; artist: string | null; duration: number | null; album_id: string;
      replay_gain_track_gain: number | null; replay_gain_track_peak: number | null;
      replay_gain_album_gain: number | null; replay_gain_album_peak: number | null;
      album_name: string | null; artwork_url: string | null;
    };
    const rows = await db.select<TrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, t.album_id,
              t.replay_gain_track_gain, t.replay_gain_track_peak,
              t.replay_gain_album_gain, t.replay_gain_album_peak,
              a.name AS album_name, a.artwork_url
       FROM tracks t
       LEFT JOIN albums a ON a.id = t.album_id
       WHERE t.id = ?`,
      [trackId]
    );
    const t = rows[0];
    if (!t) return;
    const artworkUrl = t.artwork_url;
    const navTrackId = stripServerPrefix(t.id, srv.id);
    const coverArtUrl = artworkUrl
      ? getCoverArtUrl(srv.url, srv.username, credential, artworkUrl, 64)
      : null;
    const streamUrl = getStreamUrl(srv.url, srv.username, credential, navTrackId);
    await play({
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      coverArtUrl,
      artworkRef: artworkUrl,
      album: t.album_name,
      albumId: t.album_id,
      replayGain: (t.replay_gain_track_gain != null || t.replay_gain_album_gain != null)
        ? {
            trackGain: t.replay_gain_track_gain,
            trackPeak: t.replay_gain_track_peak,
            albumGain: t.replay_gain_album_gain,
            albumPeak: t.replay_gain_album_peak,
          }
        : null,
    }, streamUrl);
  }

  async function handleStartRadioFromAlbum(album: AlbumRow, mode: RadioMode) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null };
    const rows = await db.select<TrackRow[]>(
      "SELECT id, title, artist, duration FROM tracks WHERE album_id = ? ORDER BY COALESCE(play_count, 0) DESC, track_number ASC",
      [album.id]
    );
    if (rows.length === 0) return;
    const topHalf = rows.slice(0, Math.max(1, Math.ceil(rows.length / 2)));
    const t = topHalf[Math.floor(Math.random() * topHalf.length)]!;
    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(srv.url, srv.username, credential, album.artwork_url, 64)
      : null;
    const track = { id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: album.artwork_url ?? null, album: album.name, albumId: album.id };
    const streamUrlFn = (tr: CurrentTrack) => getStreamUrl(srv.url, srv.username, credential, stripServerPrefix(tr.id, srv.id));
    await playQueue([track], streamUrlFn, 0);
    startRadio(track, mode);
  }

  async function handleAddAlbumToQueue(album: AlbumRow) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null };
    const rows = await db.select<TrackRow[]>(
      "SELECT id, title, artist, duration FROM tracks WHERE album_id = ? ORDER BY disc_number ASC, track_number ASC",
      [album.id]
    );
    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(srv.url, srv.username, credential, album.artwork_url, 64)
      : null;
    const streamUrlFn = (tr: CurrentTrack) => getStreamUrl(srv.url, srv.username, credential, stripServerPrefix(tr.id, srv.id));
    for (const t of rows) {
      const track = { id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: album.artwork_url ?? null, album: album.name, albumId: album.id };
      addToQueue(track, streamUrlFn);
    }
  }

  async function handlePlayGenre(canonicalId: string, genreLabel?: string) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null; album_id: string; artwork_url: string | null; album_name: string | null };
    const rows = await db.select<TrackRow[]>(
      `SELECT DISTINCT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name
       FROM tracks t
       JOIN albums a ON t.album_id = a.id
       JOIN album_genres ag ON ag.album_id = a.id
       WHERE ag.canonical_id = ?
       ORDER BY RANDOM()`,
      [canonicalId]
    );
    if (rows.length === 0) return;
    const streamUrlFn = (tr: CurrentTrack) =>
      getStreamUrl(srv.url, srv.username, credential, stripServerPrefix(tr.id, srv.id));
    const tracks: CurrentTrack[] = rows.map((t) => ({
      id: t.id, title: t.title, artist: t.artist, duration: t.duration,
      coverArtUrl: t.artwork_url ? getCoverArtUrl(srv.url, srv.username, credential, t.artwork_url, 64) : null,
      artworkRef: t.artwork_url ?? null, album: t.album_name ?? null, albumId: t.album_id,
    }));
    await playQueue(tracks, streamUrlFn, 0);
    startRadio(tracks[0]!, "same-genre", genreLabel);
  }

  async function handleStartRadioFromArtist(artist: ArtistRow, mode: RadioMode) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null; album_id: string; artwork_url: string | null; album_name: string | null };
    const rows = await db.select<TrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name
       FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
       WHERE t.artist = ? OR a.artist = ?
       ORDER BY random() LIMIT 1`,
      [artist.name, artist.name]
    );
    const t = rows[0];
    if (!t) return;
    const coverArtUrl = t.artwork_url
      ? getCoverArtUrl(srv.url, srv.username, credential, t.artwork_url, 64)
      : null;
    const track = { id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: t.artwork_url ?? null, album: t.album_name ?? null, albumId: t.album_id };
    const streamUrlFn = (tr: CurrentTrack) => getStreamUrl(srv.url, srv.username, credential, stripServerPrefix(tr.id, srv.id));
    await playQueue([track], streamUrlFn, 0);
    startRadio(track, mode);
  }

  // Resolve an album id to a full row, then open it. Used where callers only
  // hold an id (playlist/track rows, the player bar) rather than an AlbumRow.
  async function openAlbumById(albumId: string) {
    const db = await getDb();
    const rows = await db.select<AlbumRow[]>("SELECT * FROM albums WHERE id = ?", [albumId]);
    if (rows[0]) openAlbum(rows[0]);
  }

  const navItems: NavItem[] = [
    { id: "home", label: "Home", icon: <House size={24} /> },
    { id: "nowplaying", label: "Now Playing", icon: <Headphones size={24} /> },
    { id: "library", label: "Library", icon: <Music size={24} /> },
    { id: "artists", label: "Artists", icon: <Users size={24} /> },
    { id: "genres", label: "Genres", icon: <Layers size={24} /> },
    { id: "years", label: "Years", icon: <Calendar size={24} /> },
    { id: "playlists", label: "Playlists", icon: <ListMusic size={24} /> },
    { id: "tracks", label: "Tracks", icon: <LayoutList size={24} /> },
    { id: "tags", label: "Tags", icon: <Tag size={24} />, badge: (hideTagBadge ? undefined : unmappedCount) || undefined },
    { id: "unidentified", label: "Unidentified", icon: <CircleHelp size={24} />, badge: unidentifiedCount || undefined },
    { id: "settings", label: "Settings", icon: <Settings size={24} /> },
  ];

  if (serversLoading) return null;

  // `servers` is undefined for a failed read as well as an empty table, so
  // falling through to the wizard here would show first-run setup to a fully
  // configured user. Finishing it would insert a *second* server row, and
  // `servers?.[0]` orders by created_at, so the app would then keep using the
  // old row while the user had just entered credentials for the new one.
  if (serversError) {
    return (
      <div className="app-fatal">
        <h1 className="app-fatal-title">Canon could not read its database</h1>
        <p className="app-fatal-message">
          {serversError instanceof Error ? serversError.message : String(serversError)}
        </p>
        <p className="app-fatal-hint">
          Your server settings and library are still on disk. This is usually a locked or
          in-use database file, so closing any other running copy of Canon and trying again
          is the first thing to check.
        </p>
        <button className="app-fatal-btn" onClick={() => { void refetchServers(); }}>
          Try again
        </button>
      </div>
    );
  }

  if (!servers || servers.length === 0) {
    return (
      <Suspense fallback={null}>
        <Wizard
          onSuccess={(newServer) => {
            queryClient.setQueryData(["servers"], [newServer]);
          }}
        />
      </Suspense>
    );
  }

  // The side queue panel was removed; the layout no longer shifts for it.
  const queueClass = "";

  const shellProps: AppViewProps = {
    server,
    serverWithCred: serverWithCred ?? null,
    albums,
    visibleAlbums,
    artists,
    allTracks,
    allTracksLoading,
    allTracksError,
    genres,
    playlists,
    searchResults,
    searchError,
    canonicalIdFilters,
    lovedOnly,
    yearFromInput,
    yearToInput,
    setCanonicalIdFilters,
    toggleCanonicalIdFilter,
    toggleLovedOnly,
    setYearFromInput,
    setYearToInput,
    filterSidebarOpen,
    setFilterSidebarOpen,
    sort,
    setSort,
    albumsPaginated,
    setAlbumsPaginated,
    syncStatus,
    syncError,
    syncProgress,
    lastSyncedAt,
    runSync,
    credError: credError ?? null,
    searchOpen,
    setSearchOpen,
    searchRaw,
    searchQuery,
    searchInputRef,
    handleSearchChange,
    clearSearch,
    homeSearchRaw,
    homeSearchQuery,
    setHomeSearchRaw,
    view,
    navigateTo,
    openAlbum,
    openArtist,
    openPlaylist,
    openAlbumById,
    goBack,
    handlePlayTrack,
    handleStartRadioFromAlbum,
    handleStartRadioFromArtist,
    handleAddAlbumToQueue,
    handlePlayGenre,
    addAlbumToPlaylist,
    createPlaylist,
    createSmartPlaylist,
    deletePlaylist,
    renamePlaylist,
    setCustomCover,
    refreshSmartPlaylist,
    updateSmartPlaylistRules,
    queueClass,
    hideTagBadge,
    setHideTagBadge,
    queryClient,
    currentTrack,
    metaBarVisible,
    navItems,
    commandPaletteOpen,
    setCommandPaletteOpen,
    feedbackOpen,
    setFeedbackOpen,
    crashReport,
    setCrashReport,
    pendingUpdate,
    setPendingUpdate,
    remoteNotice,
    setRemoteNotice,
    setLastSeenNoticeId,
    sidebarExpanded,
    setSidebarExpanded,
    sidebarLiveWidth,
    sidebarWidth,
    handleSidebarResizeMouseDown,
  };

  return <AppShell {...shellProps} />;
}
