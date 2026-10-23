import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CircleHelp,
  Headphones,
  House,
  Layers,
  LayoutList,
  ListMusic,
  Music,
  Search,
  Settings,
  Tag,
  Users,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

const Wizard = lazy(() => import("./features/setup/Wizard").then((m) => ({ default: m.Wizard })));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Update } from "@tauri-apps/plugin-updater";
import type { AppViewProps, NavItem } from "./app/AppRoutes";
import { AppShell } from "./app/AppShell";
import { DatabaseErrorScreen } from "./app/DatabaseErrorScreen";
import canonFaviconUrl from "./assets/canon-logo-kit/canon-favicon.svg?url";
import {
  getCoverArtUrl,
  getStreamUrl,
  initCoverServer,
  setStreamMaxBitrate,
  updateCoverProxyConfig,
} from "./clients/navidromeUrls";
import { getDb } from "./db";
import { useFailedLookupAlbumIds } from "./features/enrichment/hooks/useAlbumIdentity";
import { useMediaSession } from "./features/playback/hooks/useMediaSession";
import { useNowPlayingPrefetch } from "./features/playback/hooks/useNowPlayingPrefetch";
import { useQueueSync } from "./features/playback/hooks/useQueueSync";
import { useScrobbleFlush } from "./features/playback/hooks/useScrobbleFlush";
import { useTrackIdRepair } from "./features/playback/hooks/useTrackIdRepair";
import { useWakeLock } from "./features/playback/hooks/useWakeLock";
import { usePlayerStore } from "./features/playback/store/player";
import type { RadioMode } from "./features/playback/store/playerTypes";
import { usePlaylists } from "./features/playlists/usePlaylists";
import { useRadio } from "./features/radio/hooks/useRadio";
import { useStartRadio } from "./features/radio/hooks/useStartRadio";
import { loadGenreSeedTracks } from "./features/radio/lib/genreSeed";
import { useSearchShortcuts } from "./features/search/useSearchShortcuts";
import { useLibrarySync } from "./features/sync/useLibrarySync";
import { useBackgroundNormalizer } from "./features/tags/hooks/useBackgroundNormalizer";
import { useUnmappedTagCount } from "./features/tags/hooks/useTagMappings";
import { useAlbums } from "./hooks/useAlbums";
import { useAllTracks } from "./hooks/useAllTracks";
import { useAppActivityTracking } from "./hooks/useAppActivityTracking";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useArtists } from "./hooks/useArtists";
import { useCoverCachePopulator } from "./hooks/useCoverCache";
import { useDismissOnNavigate } from "./hooks/useDismissOnNavigate";
import { useGenres } from "./hooks/useGenres";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useLoved } from "./hooks/useLoved";
import { useRemoteNotice } from "./hooks/useRemoteNotice";
import { useServers, useServerWithCredential } from "./hooks/useServer";
import { useBoolSetting, useSetting } from "./hooks/useSetting";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { loadAlbumTracksForPlay } from "./lib/albumTracks";
import { extractAccent } from "./lib/artColor";
import { ROUTES } from "./lib/routes";
import { currentTrackFromRow, makeStreamUrlBuilder, type PlayableTrackRow } from "./lib/track";
import { checkForUpdate } from "./lib/updater";
import { useLibraryFiltersStore } from "./store/libraryFilters";
import type { AlbumRow, AlbumSort, ArtistRow } from "./types/library";
import { useOverlayAbove } from "./ui/keyboardOwners";
import "./styles/tokens.css";
import "./app/library.css";
import "./styles/base.css";
import { parseIntegerOr } from "./lib/numberSetting";
import { REPLAY_GAIN_COLUMNS, type ReplayGainColumns, replayGainFromRow } from "./lib/replayGainRow";

// A background check that fails stays quiet, like one that finds nothing; only the log tells them apart.
function runBackgroundUpdateCheck(onFound: (update: Update) => void): void {
  void checkForUpdate().then(
    (update) => {
      if (update) onFound(update);
    },
    (error: unknown) => console.warn("[updater] update check failed:", error),
  );
}

export default function App() {
  useWakeLock();
  useAppActivityTracking();
  useRadio();
  useBackgroundNormalizer();

  const loadSettings = usePlayerStore((s) => s.loadSettings);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const startRadio = useStartRadio();
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const setStreamUrlFor = usePlayerStore((s) => s.setStreamUrlFor);
  const setAccentColor = usePlayerStore((s) => s.setAccentColor);

  const canonicalIdFilters = useLibraryFiltersStore((s) => s.canonicalIdFilters);
  const lovedOnly = useLibraryFiltersStore((s) => s.lovedOnly);
  const yearFromInput = useLibraryFiltersStore((s) => s.yearFromInput);
  const yearToInput = useLibraryFiltersStore((s) => s.yearToInput);
  const setCanonicalIdFilters = useLibraryFiltersStore((s) => s.setCanonicalIdFilters);
  const toggleCanonicalIdFilter = useLibraryFiltersStore((s) => s.toggleCanonicalIdFilter);
  const toggleLovedOnly = useLibraryFiltersStore((s) => s.toggleLovedOnly);
  const setYearFromInput = useLibraryFiltersStore((s) => s.setYearFromInput);
  const setYearToInput = useLibraryFiltersStore((s) => s.setYearToInput);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Not URL-backed, so it must be dismissed centrally in useAppNavigation; per-handler
  // setCommandPaletteOpen calls couldn't cover navigation started elsewhere.
  const dismissOverlays = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  const {
    view,
    pathname,
    navigateTo,
    openAlbum,
    openAlbumAtTrack,
    openArtist,
    openPlaylist,
    searchFor,
    goBack,
    leaveSearch,
  } = useAppNavigation(dismissOverlays);

  const [sidebarExpanded, setSidebarExpanded] = useBoolSetting("sidebar.expanded", false);
  const {
    liveWidth: sidebarLiveWidth,
    savedWidth: sidebarWidth,
    handleMouseDown: handleSidebarResizeMouseDown,
  } = useSidebarResize({
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
  const { data: serverWithCred, error: credError, refetch: refetchCredential } = useServerWithCredential(server?.id);
  // Derived, not `isPending`: the query is `enabled: !!server?.id`, so a disabled query stays
  // `pending` forever and can't tell "keychain read running" from "no server to read for".
  const credPending = !!server && !serverWithCred && !credError;
  // Needs the credential to build a full-size artwork URL for the OS now-playing panel,
  // so it is mounted here rather than at the top with the other playback hooks.
  useMediaSession(serverWithCred);
  useTrackIdRepair(serverWithCred);
  // Below the server read rather than up with the playback hooks: its queries are scoped by
  // server id, and a warm keyed on a different id than the tab reads is a warm nobody reads.
  useNowPlayingPrefetch(server?.id ?? null);

  const { syncStatus, syncError, syncProgress, lastSyncedAt, nextRetryAt, runSync } = useLibrarySync(serverWithCred);
  useCoverCachePopulator(serverWithCred ?? undefined);

  // One signal for "an overlay above the app owns the keyboard", read by the search shortcuts,
  // the transport keys and Now Playing's V; modals, the palette and menus register themselves.
  const overlayAbove = useOverlayAbove();

  useGlobalShortcuts(serverWithCred, overlayAbove);
  useQueueSync(serverWithCred);
  useScrobbleFlush(serverWithCred);

  const [rawSort, setSort, sortLoaded] = useSetting("library_sort", "artist");
  const sort = (
    ["artist", "alphabetical", "year", "recently_added"].includes(rawSort) ? rawSort : "artist"
  ) as AlbumSort;

  // Gated on `pathname` not `view` (folds /album/:id into "library") and on `sortLoaded`
  // to avoid scanning once with the default sort and again once the real sort arrives.
  const {
    data: albums,
    isLoading: albumsLoading,
    error: albumsError,
  } = useAlbums(sort, canonicalIdFilters, pathname === "/library" && sortLoaded);
  const { data: artists, isLoading: artistsLoading, error: artistsError } = useArtists(pathname === "/artists");
  const { data: allTracks, isLoading: allTracksLoading, error: allTracksError } = useAllTracks(pathname === "/tracks");
  const { data: genres, error: genresError, retry: retryGenres } = useGenres(pathname === "/library");
  // Ungated: one cheap shared invoke, and lovedAlbumIds feeds the visibleAlbums memo.
  const { lovedAlbumIds } = useLoved();
  const {
    data: playlists,
    createPlaylist,
    createSmartPlaylist,
    addAlbumToPlaylist,
    deletePlaylist,
    renamePlaylist,
    setCustomCover,
    refreshSmartPlaylist,
    updateSmartPlaylistRules,
  } = usePlaylists();
  // Scalar count for the sidebar badge. The full tag vocabulary is fetched only inside
  // the lazily-loaded Tags route, which is where the rows are actually used.
  const { data: unmappedCountRaw } = useUnmappedTagCount();
  const unmappedCount = unmappedCountRaw ?? 0;
  const [hideTagBadge, setHideTagBadge] = useBoolSetting("ui.hide_tag_badge", false);
  const { data: failedLookupIds } = useFailedLookupAlbumIds(server?.id);
  const unidentifiedCount = failedLookupIds?.length ?? 0;
  const [albumsPaginated, setAlbumsPaginated] = useBoolSetting("albums.pagination", false);

  const visibleAlbums = useMemo(() => {
    if (albums === undefined) return [];
    const yearFrom = parseIntegerOr(yearFromInput, null);
    const yearTo = parseIntegerOr(yearToInput, null);
    let result = lovedOnly ? albums.filter((a) => lovedAlbumIds.has(a.id)) : albums;
    if (yearFrom !== null) result = result.filter((a) => (a.year ?? 0) >= yearFrom);
    if (yearTo !== null) result = result.filter((a) => (a.year ?? 9999) <= yearTo);
    return result;
  }, [albums, lovedOnly, lovedAlbumIds, yearFromInput, yearToInput]);

  const [filterSidebarOpen, setFilterSidebarOpen] = useBoolSetting("filter_sidebar_open", true);

  const [homeSearchRaw, setHomeSearchRaw] = useState("");
  const [homeSearchQuery, setHomeSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setHomeSearchQuery(homeSearchRaw), 200);
    return () => clearTimeout(t);
  }, [homeSearchRaw]);

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
  const { remoteNotice, dismissRemoteNotice } = useRemoteNotice();
  const [autoCheckUpdates] = useBoolSetting("updates.auto_check", false);
  const [autoCheckIntervalMin] = useSetting("updates.auto_check_interval_min", "60");
  const [streamMaxBitrate] = useSetting("stream.max_bitrate", "0");
  useEffect(() => {
    setStreamMaxBitrate(parseInt(streamMaxBitrate, 10));
  }, [streamMaxBitrate]);
  useEffect(() => {
    runBackgroundUpdateCheck(setPendingUpdate);
  }, []);
  useEffect(() => {
    if (!autoCheckUpdates) return;
    const ms = Math.max(10, parseIntegerOr(autoCheckIntervalMin, 60)) * 60 * 1000;
    const id = setInterval(() => runBackgroundUpdateCheck(setPendingUpdate), ms);
    return () => clearInterval(id);
  }, [autoCheckUpdates, autoCheckIntervalMin]);

  // Covers navigation that bypasses useAppNavigation (e.g. AppRoutes redirecting after a
  // playlist delete). Keyed on pathname alone so a `?q` change on /search doesn't close it.
  useDismissOnNavigate(pathname, dismissOverlays);

  useSearchShortcuts({
    searchInputRef,
    searchActive: pathname === ROUTES.SEARCH,
    commandPaletteOpen,
    // Registry-based so it also covers modals opened inside /search itself (e.g. the identify
    // dialog), whose open state never reaches this component directly.
    overlayAbove,
    toggleCommandPalette: useCallback(() => setCommandPaletteOpen((open) => !open), []),
    openSearch: useCallback(() => navigateTo("search"), [navigateTo]),
    leaveSearch,
  });

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Cover art proxy: push credentials to Rust first, then enable proxy URLs only after config is confirmed.
  // Sequenced in one effect to prevent a window where proxy URLs are returned but the Rust config is still None.
  useEffect(() => {
    if (!serverWithCred) return;
    void (async () => {
      try {
        await updateCoverProxyConfig(
          serverWithCred.server.url,
          serverWithCred.server.username,
          serverWithCred.credential,
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
    const title = currentTrack ? `${currentTrack.title}${currentTrack.artist ? ` - ${currentTrack.artist}` : ""}` : "";
    void invoke("tray_update", { title, isPlaying }).catch(() => {});
  }, [showTrayIcon, currentTrack?.id, isPlaying]);

  // Tray actions: play_pause and next forwarded to player store
  useEffect(() => {
    const p = listen<string>("tray-action", (e) => {
      const store = usePlayerStore.getState();
      if (e.payload === "play_pause") {
        if (store.isPlaying) store.pause();
        else store.resume();
      } else if (e.payload === "next") {
        void store.next();
      }
    });
    return () => {
      void p.then((fn) => fn());
    };
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
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-hover");
      document.documentElement.style.removeProperty("--accent-subtle");
      return;
    }
    let cancelled = false;
    void extractAccent(artUrl).then((color) => {
      if (cancelled) return;
      setAccentColor(color);
      if (color) {
        document.documentElement.style.setProperty("--accent", color);
        document.documentElement.style.setProperty("--accent-hover", `color-mix(in oklab, ${color} 85%, black)`);
        // parse rgb(...) to build subtle
        const m = color.match(/\d+/g);
        if (m) {
          document.documentElement.style.setProperty("--accent-subtle", `rgba(${m[0]}, ${m[1]}, ${m[2]}, 0.18)`);
        }
      }
    });
    return () => {
      cancelled = true;
    };
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
    if (!currentTrack) {
      document.title = "Canon";
      return;
    }
    const parts = [currentTrack.artist, currentTrack.title].filter(Boolean);
    document.title = parts.length > 0 ? `${parts.join(" - ")} · Canon` : "Canon";
  }, [currentTrack?.title, currentTrack?.artist]);

  async function handlePlayTrack(trackId: string) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    const rows = await db.select<PlayableTrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, t.album_id, ${REPLAY_GAIN_COLUMNS},
              a.name AS album_name, a.artwork_url
       FROM tracks t
       LEFT JOIN albums a ON a.id = t.album_id
       WHERE t.id = ?`,
      [trackId],
    );
    const t = rows[0];
    if (!t) return;
    await play(currentTrackFromRow(t, srv, credential), makeStreamUrlBuilder(srv, credential));
  }

  async function handleStartRadioFromAlbum(album: AlbumRow, mode: RadioMode) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    // Fetches the album on a miss; the seed is picked by play count, which the shared
    // loader does not order by, so the rows are read again once they are there.
    if ((await loadAlbumTracksForPlay(srv, credential, album)).length === 0) return;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null } & ReplayGainColumns;
    const rows = await db.select<TrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, ${REPLAY_GAIN_COLUMNS} FROM tracks t WHERE t.album_id = ? AND t.server_id = ? ORDER BY COALESCE(t.play_count, 0) DESC, t.track_number ASC`,
      [album.id, srv.id],
    );
    if (rows.length === 0) return;
    const topHalf = rows.slice(0, Math.max(1, Math.ceil(rows.length / 2)));
    const t = topHalf[Math.floor(Math.random() * topHalf.length)]!;
    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(srv.url, srv.username, credential, album.artwork_url, 64)
      : null;
    const track = {
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      coverArtUrl,
      artworkRef: album.artwork_url ?? null,
      album: album.name,
      albumId: album.id,
      replayGain: replayGainFromRow(t),
    };
    await startRadio({ tracks: [track], streamUrlFor: makeStreamUrlBuilder(srv, credential), mode });
  }

  async function handleAddAlbumToQueue(album: AlbumRow) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const rows = await loadAlbumTracksForPlay(srv, credential, album);
    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(srv.url, srv.username, credential, album.artwork_url, 64)
      : null;
    const streamUrlFor = makeStreamUrlBuilder(srv, credential);
    for (const t of rows) {
      const track = {
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        coverArtUrl,
        artworkRef: album.artwork_url ?? null,
        album: album.name,
        albumId: album.id,
        replayGain: replayGainFromRow(t),
      };
      addToQueue(track, streamUrlFor);
    }
  }

  async function handlePlayGenre(canonicalId: string, genreLabel?: string) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const rows = await loadGenreSeedTracks({ serverId: srv.id, canonicalId, isDirectOnly: false });
    if (rows.length === 0) return;
    const tracks = rows.map((t) => currentTrackFromRow(t, srv, credential));
    await startRadio({
      tracks,
      streamUrlFor: makeStreamUrlBuilder(srv, credential),
      mode: "same-genre",
      label: genreLabel,
    });
  }

  async function handleStartRadioFromArtist(artist: ArtistRow, mode: RadioMode) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    const rows = await db.select<PlayableTrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name,
              ${REPLAY_GAIN_COLUMNS}
       FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
       WHERE t.server_id = ?
         AND (t.artist = ? OR a.artist = ?)
       ORDER BY random() LIMIT 1`,
      [srv.id, artist.name, artist.name],
    );
    const t = rows[0];
    if (!t) return;
    const track = currentTrackFromRow(t, srv, credential);
    await startRadio({ tracks: [track], streamUrlFor: makeStreamUrlBuilder(srv, credential), mode });
  }

  // Resolve an album id to a full row, then open it. Used where callers only
  // hold an id (playlist/track rows, the player bar) rather than an AlbumRow.
  async function openAlbumById(albumId: string) {
    if (!server) return;
    const db = await getDb();
    const rows = await db.select<AlbumRow[]>("SELECT * FROM albums WHERE id = ? AND server_id = ?", [
      albumId,
      server.id,
    ]);
    if (rows[0]) openAlbum(rows[0]);
  }

  const navItems: NavItem[] = [
    { id: "home", label: "Home", icon: <House size={24} /> },
    { id: "search", label: "Search", icon: <Search size={24} /> },
    { id: "nowplaying", label: "Now Playing", icon: <Headphones size={24} /> },
    { id: "library", label: "Library", icon: <Music size={24} /> },
    { id: "artists", label: "Artists", icon: <Users size={24} /> },
    { id: "genres", label: "Genres", icon: <Layers size={24} /> },
    { id: "years", label: "Years", icon: <Calendar size={24} /> },
    { id: "playlists", label: "Playlists", icon: <ListMusic size={24} /> },
    { id: "tracks", label: "Tracks", icon: <LayoutList size={24} /> },
    {
      id: "tags",
      label: "Tags",
      icon: <Tag size={24} />,
      badge: (hideTagBadge ? undefined : unmappedCount) || undefined,
    },
    {
      id: "unidentified",
      label: "Unidentified",
      icon: <CircleHelp size={24} />,
      badge: unidentifiedCount || undefined,
    },
    { id: "settings", label: "Settings", icon: <Settings size={24} /> },
  ];

  if (serversLoading) return null;

  // `servers` is undefined for a failed read as well as an empty table; falling through to
  // the wizard would insert a second row and `servers?.[0]` would keep using the old one.
  if (serversError) {
    return (
      <DatabaseErrorScreen
        error={serversError}
        onRetry={() => {
          void refetchServers();
        }}
      />
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
    albumsLoading,
    albumsError,
    visibleAlbums,
    artists,
    artistsLoading,
    artistsError,
    allTracks,
    allTracksLoading,
    allTracksError,
    genres,
    genresError,
    retryGenres,
    playlists,
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
    nextRetryAt,
    runSync,
    credError: credError ?? null,
    credPending,
    retryCredential: () => {
      void refetchCredential();
    },
    searchInputRef,
    homeSearchRaw,
    homeSearchQuery,
    setHomeSearchRaw,
    view,
    navigateTo,
    openAlbum,
    openAlbumAtTrack,
    openArtist,
    openPlaylist,
    openAlbumById,
    searchFor,
    goBack,
    leaveSearch,
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
    dismissRemoteNotice,
    sidebarExpanded,
    setSidebarExpanded,
    sidebarLiveWidth,
    sidebarWidth,
    handleSidebarResizeMouseDown,
  };

  return <AppShell {...shellProps} />;
}
