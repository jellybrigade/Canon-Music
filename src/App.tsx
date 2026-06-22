import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useClickOutside } from "./hooks/useClickOutside";
import { useQueryClient } from "@tanstack/react-query";
import { Music, Users, Tag, Settings, Heart, Search, X, ListMusic, Headphones, House, ChevronLeft, ChevronRight, Layers, MessageSquare, Calendar, LayoutList } from "lucide-react";
import { AlbumGrid } from "./components/AlbumGrid";
const Wizard       = lazy(() => import("./components/setup/Wizard").then((m) => ({ default: m.Wizard })));
const AlbumDetail  = lazy(() => import("./components/AlbumDetail").then((m) => ({ default: m.AlbumDetail })));
const ArtistGrid   = lazy(() => import("./components/ArtistGrid").then((m) => ({ default: m.ArtistGrid })));
const ArtistDetail = lazy(() => import("./components/ArtistDetail").then((m) => ({ default: m.ArtistDetail })));
const PlaylistList = lazy(() => import("./components/PlaylistList").then((m) => ({ default: m.PlaylistList })));
const PlaylistDetail = lazy(() => import("./components/PlaylistDetail").then((m) => ({ default: m.PlaylistDetail })));
const SearchResults  = lazy(() => import("./components/SearchResults").then((m) => ({ default: m.SearchResults })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const SettingsView   = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
const TagsView       = lazy(() => import("./components/TagsView").then((m) => ({ default: m.TagsView })));
const HomeView       = lazy(() => import("./components/HomeView").then((m) => ({ default: m.HomeView })));
const GenreView      = lazy(() => import("./components/GenreView").then((m) => ({ default: m.GenreView })));
const YearsView      = lazy(() => import("./components/YearsView").then((m) => ({ default: m.YearsView })));
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { CanonLockup } from "./components/CanonIcon";
const NowPlayingView = lazy(() => import("./components/NowPlayingView").then((m) => ({ default: m.NowPlayingView })));
import { useServers, useServerWithCredential } from "./hooks/useServer";
import { useAlbums } from "./hooks/useAlbums";
import { useArtists } from "./hooks/useArtists";
import { useGenres } from "./hooks/useGenres";
import { useLoved } from "./hooks/useLoved";
import { useSearch } from "./hooks/useSearch";
import { useBoolSetting, useSetting } from "./hooks/useSetting";
import { usePlaylists } from "./hooks/usePlaylists";
import { useScrobbleFlush } from "./hooks/useScrobbleFlush";
import { useTagVocab } from "./hooks/useTagMappings";
import { useMediaSession } from "./hooks/useMediaSession";
import { useRadio } from "./hooks/useRadio";
import { useBackgroundNormalizer } from "./hooks/useBackgroundNormalizer";
import { useTrackEndedListener } from "./hooks/useTrackEndedListener";
import { useScrobble } from "./hooks/useScrobble";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useWakeLock } from "./hooks/useWakeLock";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useLibrarySync } from "./hooks/useLibrarySync";
import { useNowPlayingPrefetch } from "./hooks/useNowPlayingPrefetch";
import { usePlayerStore } from "./store/player";
import { useTagsStore } from "./store/tags";
import { useLibraryFiltersStore } from "./store/libraryFilters";
import type { RadioMode, CurrentTrack } from "./store/player";
import { extractAccent } from "./lib/artColor";
import { checkForUpdate } from "./lib/updater";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { FeedbackModal } from "./components/FeedbackModal";
import { getCoverArtUrl, getStreamUrl, setStreamMaxBitrate } from "./lib/navidrome";
import { stripServerPrefix } from "./utils/ids";
import { getDb } from "./db";
import type { Update } from "@tauri-apps/plugin-updater";
import type { AlbumRow, AlbumSort, ArtistRow } from "./types/library";
import "./styles/tokens.css";
import "./styles/library.css";
import "./styles/base.css";
import "./App.css";

export default function App() {
  useTrackEndedListener();
  useMediaSession();
  useWakeLock();
  useRadio();
  useBackgroundNormalizer();
  useNowPlayingPrefetch();

  const loadSettings = usePlayerStore((s) => s.loadSettings);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const elapsed = usePlayerStore((s) => s.elapsed);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const play = usePlayerStore((s) => s.play);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
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
    selectedAlbum,
    selectedArtist,
    selectedPlaylist,
    setSelectedAlbum,
    setSelectedPlaylist,
    navigateTo,
    openAlbum,
    openArtist,
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
  const { data: servers, isLoading: serversLoading } = useServers();
  const server = servers?.[0];
  const { data: serverWithCred, error: credError } = useServerWithCredential(server?.id);

  const { syncStatus, syncError, lastSyncedAt, runSync } = useLibrarySync(server, queryClient);

  useGlobalShortcuts(serverWithCred);
  useScrobbleFlush(serverWithCred);
  useScrobble(currentTrack, elapsed, serverWithCred);

  const [rawSort, setSort] = useSetting("library_sort", "artist");
  const sort = (["artist", "alphabetical", "year", "recently_added"].includes(rawSort)
    ? rawSort
    : "artist") as AlbumSort;

  const { data: albums } = useAlbums(sort, canonicalIdFilters);
  const { data: artists } = useArtists();
  const { data: genres } = useGenres();
  const { data: vocab } = useTagVocab();
  const { lovedAlbumIds } = useLoved();
  const { data: playlists, createPlaylist, deletePlaylist, renamePlaylist, addAlbumToPlaylist } = usePlaylists();
  const unmappedCount = vocab?.filter((r) => !r.canonical_id && r.album_count > 0).length ?? 0;
  const [hideTagBadge, setHideTagBadge] = useBoolSetting("ui.hide_tag_badge", false);
  const [albumsPaginated, setAlbumsPaginated] = useBoolSetting("albums.pagination", false);

  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const genreDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(genreDropdownRef, () => setGenreDropdownOpen(false), genreDropdownOpen);

  const [searchRaw, setSearchRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: searchResults } = useSearch(searchQuery);

  const [homeSearchRaw, setHomeSearchRaw] = useState("");
  const [homeSearchQuery, setHomeSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setHomeSearchQuery(homeSearchRaw), 200);
    return () => clearTimeout(t);
  }, [homeSearchRaw]);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
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
    setSearchRaw("");
    setSearchQuery("");
    setSearchOpen(false);
    searchInputRef.current?.blur();
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
        document.documentElement.style.setProperty('--accent-hover', color);
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
      link.href = "/icon.svg";
    }
  }, [currentTrack?.coverArtUrl]);

  useEffect(() => {
    if (!currentTrack) { document.title = "Canon"; return; }
    const parts = [currentTrack.artist, currentTrack.title].filter(Boolean);
    document.title = parts.length > 0 ? `${parts.join(" – ")} · Canon` : "Canon";
  }, [currentTrack?.title, currentTrack?.artist]);

  async function handlePlayTrack(trackId: string) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null; album_id: string };
    const rows = await db.select<TrackRow[]>(
      "SELECT id, title, artist, duration, album_id FROM tracks WHERE id = ?",
      [trackId]
    );
    const t = rows[0];
    if (!t) return;
    type AlbumMeta = { artwork_url: string | null; name: string };
    const albumRows = await db.select<AlbumMeta[]>(
      "SELECT artwork_url, name FROM albums WHERE id = ?",
      [t.album_id]
    );
    const albumData = albumRows[0] ?? null;
    const artworkUrl = albumData?.artwork_url ?? null;
    const navTrackId = stripServerPrefix(t.id, srv.id);
    const coverArtUrl = artworkUrl
      ? getCoverArtUrl(srv.url, srv.username, credential, artworkUrl, 64)
      : null;
    const streamUrl = getStreamUrl(srv.url, srv.username, credential, navTrackId);
    await play({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: artworkUrl, album: albumData?.name ?? null, albumId: t.album_id }, streamUrl);
  }

  async function handleStartRadioFromAlbum(album: AlbumRow, mode: RadioMode) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null };
    const rows = await db.select<TrackRow[]>(
      "SELECT id, title, artist, duration FROM tracks WHERE album_id = ? ORDER BY track_number ASC, id ASC LIMIT 1",
      [album.id]
    );
    const t = rows[0];
    if (!t) return;
    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(srv.url, srv.username, credential, album.artwork_url, 64)
      : null;
    const track = { id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: album.artwork_url ?? null, album: album.name, albumId: album.id };
    const streamUrlFn = (tr: CurrentTrack) => getStreamUrl(srv.url, srv.username, credential, stripServerPrefix(tr.id, srv.id));
    await playQueue([track], streamUrlFn, 0);
    startRadio(track, mode);
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

  const NAV_ITEMS: { id: import("./hooks/useAppNavigation").AppView; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "home", label: "Home", icon: <House size={24} /> },
    { id: "nowplaying", label: "Now Playing", icon: <Headphones size={24} /> },
    { id: "library", label: "Library", icon: <Music size={24} /> },
    { id: "artists", label: "Artists", icon: <Users size={24} /> },
    { id: "genres", label: "Genres", icon: <Layers size={24} /> },
    { id: "years", label: "Years", icon: <Calendar size={24} /> },
    { id: "playlists", label: "Playlists", icon: <ListMusic size={24} /> },
    { id: "tags", label: "Tags", icon: <Tag size={24} />, badge: (hideTagBadge ? undefined : unmappedCount) || undefined },
    { id: "settings", label: "Settings", icon: <Settings size={24} /> },
  ];

  if (serversLoading) return null;

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

  const queueClass = isQueueOpen ? " library--queue-open" : "";

  const SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
    { value: "recently_added", label: "Recent" },
    { value: "artist", label: "Artist" },
    { value: "alphabetical", label: "A–Z" },
    { value: "year", label: "Year" },
  ];

  function renderSearchBar() {
    return (
      <div className="search-bar">
        <Search size={15} className="search-bar-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="search-bar-input"
          placeholder="Search…"
          value={searchRaw}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {searchRaw && (
          <button className="search-bar-clear" onClick={clearSearch} title="Clear search">
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  function renderLibraryContent() {
    if (!serverWithCred || albums === undefined) {
      return <p className="empty-state">Loading…</p>;
    }
    if (searchQuery && searchResults) {
      return (
        <SearchResults
          albums={searchResults.albums}
          tracks={searchResults.tracks}
          artists={searchResults.artists}
          serverWithCredential={serverWithCred}
          onSelectAlbum={openAlbum}
          onSelectArtist={(artist) => { clearSearch(); navigateTo("artists", { artist: { name: artist.name, album_count: artist.album_count, artwork_url: null } }); }}
          onPlayTrack={(id) => { void handlePlayTrack(id); }}
        />
      );
    }
    if (searchQuery && !searchResults) {
      return <p className="empty-state">Searching…</p>;
    }
    const yearFrom = yearFromInput ? parseInt(yearFromInput, 10) : null;
    const yearTo = yearToInput ? parseInt(yearToInput, 10) : null;
    let visibleAlbums = lovedOnly ? albums.filter((a) => lovedAlbumIds.has(a.id)) : albums;
    if (yearFrom != null && !isNaN(yearFrom)) visibleAlbums = visibleAlbums.filter((a) => (a.year ?? 0) >= yearFrom);
    if (yearTo != null && !isNaN(yearTo)) visibleAlbums = visibleAlbums.filter((a) => (a.year ?? 9999) <= yearTo);
    const filtersActive = lovedOnly || canonicalIdFilters.length > 0 || yearFromInput !== "" || yearToInput !== "";
    const emptyMessage = lovedOnly
      ? "No loved albums"
      : filtersActive
        ? "No albums match this filter"
        : "No albums yet. Syncing…";
    return (
      <AlbumGrid
        albums={visibleAlbums}
        serverWithCredential={serverWithCred}
        onSelect={openAlbum}
        onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
        onAddAlbumToPlaylist={serverWithCred ? (album, pl) => { void addAlbumToPlaylist(pl, album.id, serverWithCred); } : undefined}
        playlists={playlists}
        emptyMessage={emptyMessage}
        scrollKey={`library-${sort}-${lovedOnly ? "loved" : ""}-${canonicalIdFilters.join(",")}-${yearFromInput}-${yearToInput}`}
        sort={sort}
      />
    );
  }

  function renderAlbumDetail() {
    if (!selectedAlbum || !serverWithCred) return null;
    return (
      <AlbumDetail
        album={selectedAlbum}
        serverWithCredential={serverWithCred}
        onClose={goBack}
        onSelectArtist={(name) => navigateTo("artists", { artist: { name, album_count: 0, artwork_url: null } })}
        onTagFilter={(canonicalId) => { setCanonicalIdFilters([canonicalId]); setSelectedAlbum(null); navigateTo("library"); }}
      />
    );
  }

  function renderContent() {
    if (selectedAlbum && serverWithCred) {
      return (
        <main className={`library${queueClass}`}>
          {renderAlbumDetail()}
        </main>
      );
    }

    if (selectedArtist && serverWithCred) {
      return (
        <main className={`library${queueClass}`}>
          <ArtistDetail
            artist={selectedArtist}
            serverWithCredential={serverWithCred}
            onClose={goBack}
            onSelectAlbum={openAlbum}
            onSelectArtist={(name) => openArtist({ name, album_count: 0, artwork_url: null })}
          />
        </main>
      );
    }

    if (searchOpen || searchQuery) {
      return (
        <main className={`library${queueClass}`}>
          <header className="library-header">
            <h1>Search</h1>
            <span className="server-name">{server?.display_name}</span>
            {renderSearchBar()}
            <button className="search-bar-clear" onClick={clearSearch} title="Close search" style={{ marginLeft: "auto" }}>
              <X size={15} />
            </button>
          </header>
          {serverWithCred && searchResults && searchQuery ? (
            <SearchResults
              albums={searchResults.albums}
              tracks={searchResults.tracks}
              artists={searchResults.artists}
              serverWithCredential={serverWithCred}
              onSelectAlbum={openAlbum}
              onSelectArtist={(artist) => { openArtist({ name: artist.name, album_count: artist.album_count, artwork_url: null }); }}
              onPlayTrack={(id) => { void handlePlayTrack(id); }}
            />
          ) : (
            <p className="empty-state">{searchQuery ? "Searching…" : "Start typing to search"}</p>
          )}
        </main>
      );
    }

    switch (view) {
      case "home":
        return (
          <Suspense fallback={null}>
            {serverWithCred ? (
              <HomeView
                serverWithCredential={serverWithCred}
                onSelectAlbum={openAlbum}
                onSelectArtist={(name) => openArtist({ name, album_count: 0, artwork_url: null })}
                onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
                onPlayTrack={(id) => { void handlePlayTrack(id); }}
                onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                homeSearchRaw={homeSearchRaw}
                homeSearchQuery={homeSearchQuery}
                onHomeSearchRawChange={setHomeSearchRaw}
              />
            ) : <main className="content-main" />}
          </Suspense>
        );

      case "nowplaying":
        return (
          <Suspense fallback={null}>
            {serverWithCred ? (
              <NowPlayingView
                serverWithCredential={serverWithCred}
                onSelectAlbum={(album) => navigateTo("library", { album })}
                onSelectArtist={(artistName) => navigateTo("artists", { artist: { name: artistName, album_count: 0, artwork_url: null } })}
                onBack={goBack}
              />
            ) : <main className="content-main" />}
          </Suspense>
        );

      case "library":
        return (
          <main className={`library${queueClass}`}>
            <header className="library-header">
              <CanonLockup height={22} className="library-header-logo" />
              <span className="server-name">{server?.display_name}</span>
              {syncStatus === "syncing" && (
                <span className="sync-status">Syncing…</span>
              )}
              {syncStatus === "error" && (
                <span className="sync-status sync-status--error" title={syncError}>
                  Sync failed: {syncError}
                </span>
              )}
              {syncStatus === "partial" && (
                <span className="sync-status sync-status--error" title={syncError ?? undefined}>
                  {syncError}
                </span>
              )}
              {credError && (
                <span className="sync-status sync-status--error">
                  Credential error: {credError instanceof Error ? credError.message : String(credError)}
                </span>
              )}
              <div className="sort-bar">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`sort-btn${sort === opt.value ? " sort-btn--active" : ""}`}
                    onClick={() => { void setSort(opt.value); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="year-range-filter">
                <input
                  className="year-range-input"
                  type="number"
                  placeholder="From"
                  value={yearFromInput}
                  onChange={(e) => setYearFromInput(e.target.value)}
                  min={1900}
                  max={2100}
                />
                <span className="year-range-sep">–</span>
                <input
                  className="year-range-input"
                  type="number"
                  placeholder="To"
                  value={yearToInput}
                  onChange={(e) => setYearToInput(e.target.value)}
                  min={1900}
                  max={2100}
                />
                {(yearFromInput !== "" || yearToInput !== "") && (
                  <button
                    className="year-range-clear"
                    onClick={() => { setYearFromInput(""); setYearToInput(""); }}
                    title="Clear year filter"
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                className="search-trigger-btn"
                onClick={() => { setSearchOpen(true); setTimeout(() => { searchInputRef.current?.focus(); }, 0); }}
                title="Search (Ctrl+F)"
              >
                <Search size={15} />
                Search…
              </button>
              {genres && genres.length > 0 && (
                <div className="genre-filter" ref={genreDropdownRef}>
                  <button
                    className={`genre-filter-btn${canonicalIdFilters.length > 0 ? " genre-filter-btn--active" : ""}`}
                    onClick={() => setGenreDropdownOpen((v) => !v)}
                    title="Filter by genre"
                  >
                    <Tag size={14} />
                    {canonicalIdFilters.length > 0 ? `Genre (${canonicalIdFilters.length})` : "Genre"}
                  </button>
                  {genreDropdownOpen && (
                    <div className="genre-dropdown">
                      {canonicalIdFilters.length > 0 && (
                        <button
                          className="genre-dropdown-clear"
                          onClick={() => setCanonicalIdFilters([])}
                        >
                          Clear
                        </button>
                      )}
                      {genres.map((g) => (
                        <button
                          key={g.canonical_id}
                          className={`genre-dropdown-item${canonicalIdFilters.includes(g.canonical_id) ? " genre-dropdown-item--active" : ""}`}
                          onClick={() => toggleCanonicalIdFilter(g.canonical_id)}
                        >
                          <span className="genre-dropdown-name">{g.name}</span>
                          <span className="genre-dropdown-count">{g.album_count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {canonicalIdFilters.length > 0 && (
                <button
                  className="genre-filter-btn genre-filter-btn--active"
                  onClick={() => setCanonicalIdFilters([])}
                  title="Clear tag filter"
                >
                  <X size={14} />
                  Tag filter
                </button>
              )}
              <button
                className={`loved-filter-btn${lovedOnly ? " loved-filter-btn--active" : ""}`}
                onClick={toggleLovedOnly}
                title={lovedOnly ? "Show all albums" : "Show loved albums"}
              >
                <Heart size={14} fill={lovedOnly ? "currentColor" : "none"} strokeWidth={2} />
                Loved
              </button>
              {server && (
                <button
                  className="rescan-btn"
                  onClick={() => runSync(server)}
                  disabled={syncStatus === "syncing"}
                >
                  Rescan
                </button>
              )}
              <button
                className={`loved-filter-btn${albumsPaginated ? " loved-filter-btn--active" : ""}`}
                onClick={() => void setAlbumsPaginated(!albumsPaginated)}
                title={albumsPaginated ? "Switch to scroll view" : "Switch to page view"}
              >
                <LayoutList size={14} />
                Pages
              </button>
            </header>
            {renderLibraryContent()}
          </main>
        );

      case "artists":
        return (
          <main className={`library${queueClass}`}>
            <header className="library-header">
              <h1>Artists</h1>
              <span className="server-name">{server?.display_name}</span>
            </header>
            {serverWithCred ? (
              <ArtistGrid
                artists={artists ?? []}
                serverWithCredential={serverWithCred}
                onSelect={openArtist}
                onStartRadio={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
                scrollKey="artists"
              />
            ) : (
              <p className="empty-state">Loading…</p>
            )}
          </main>
        );

      case "genres":
        return (
          <Suspense fallback={null}>
            <main className={`library${queueClass}`}>
              <GenreView
                onSelectGenre={(canonicalId) => {
                  setCanonicalIdFilters([canonicalId]);
                  navigateTo("library");
                }}
                onPlayGenre={(canonicalId, label) => { void handlePlayGenre(canonicalId, label); }}
              />
            </main>
          </Suspense>
        );

      case "years":
        return (
          <Suspense fallback={null}>
            {serverWithCred ? (
              <YearsView
                serverWithCredential={serverWithCred}
                onSelect={openAlbum}
                onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
                serverDisplayName={server?.display_name}
              />
            ) : <main className="content-main" />}
          </Suspense>
        );

      case "playlists":
        return (
          <main className={`library${queueClass}`}>
            {selectedPlaylist && serverWithCred ? (
              <PlaylistDetail
                playlist={selectedPlaylist}
                serverWithCredential={serverWithCred}
                onClose={() => setSelectedPlaylist(null)}
                onDelete={async () => {
                  await deletePlaylist(selectedPlaylist, serverWithCred);
                  setSelectedPlaylist(null);
                }}
                onRename={renamePlaylist}
                onSelectAlbum={async (albumId) => {
                  const db = await getDb();
                  const rows = await db.select<AlbumRow[]>("SELECT * FROM albums WHERE id = ?", [albumId]);
                  if (rows[0]) openAlbum(rows[0]);
                }}
                onSelectArtist={(artistName) => navigateTo("artists", { artist: { name: artistName, album_count: 0, artwork_url: null } })}
              />
            ) : (
              <>
                <header className="library-header">
                  <h1>Playlists</h1>
                  <span className="server-name">{server?.display_name}</span>
                </header>
                {serverWithCred ? (
                  <PlaylistList
                    playlists={playlists ?? []}
                    serverWithCredential={serverWithCred}
                    onSelect={setSelectedPlaylist}
                    onCreatePlaylist={createPlaylist}
                  />
                ) : (
                  <p className="empty-state">Loading…</p>
                )}
              </>
            )}
          </main>
        );

      case "tags":
        return (
          <Suspense fallback={null}>
            <TagsView />
          </Suspense>
        );

      case "settings":
        return (
          <main className="content-main">
            <SettingsView
              syncStatus={syncStatus}
              syncError={syncError}
              lastSyncedAt={lastSyncedAt}
              serverWithCredential={serverWithCred}
              onRemoveServer={() => {
                queryClient.setQueryData(["servers"], []);
              }}
              hideTagBadge={hideTagBadge}
              setHideTagBadge={setHideTagBadge}
            />
          </main>
        );
    }
  }

  return (
    <Suspense fallback={null}>
      <div className="app-layout">
        <nav
          className={`sidebar${sidebarExpanded ? " sidebar--expanded" : ""}${sidebarLiveWidth !== null ? " sidebar--dragging" : ""}`}
          style={{
            width: sidebarExpanded ? `${sidebarLiveWidth ?? sidebarWidth}px` : undefined,
            paddingBottom: currentTrack
              ? `calc(var(--player-bar-height) + ${metaBarVisible ? 28 : 4}px)`
              : `${metaBarVisible ? 28 : 4}px`,
          }}
        >
          {NAV_ITEMS.map(({ id, label, icon, badge }) => (
            <button
              key={id}
              className={`sidebar-btn${view === id ? " sidebar-btn--active" : ""}`}
              title={badge ? `${label} (${badge} unmapped)` : label}
              onClick={() => { setCanonicalIdFilters([]); navigateTo(id); }}
            >
              <span className="sidebar-btn-icon">
                {icon}
                {badge ? <span className="sidebar-badge">{badge > 99 ? "99+" : badge}</span> : null}
              </span>
              {sidebarExpanded && <span className="sidebar-btn-label">{label}</span>}
            </button>
          ))}
          {view !== "nowplaying" && (
            <>
              <button
                className="sidebar-feedback-btn"
                title="Send feedback"
                onClick={() => setFeedbackOpen(true)}
              >
                <MessageSquare size={15} />
                {sidebarExpanded && <span className="sidebar-btn-label">Feedback</span>}
              </button>
              <button
                className="sidebar-expand-btn"
                title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
                onClick={() => void setSidebarExpanded(!sidebarExpanded)}
              >
                {sidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </>
          )}
          {sidebarExpanded && (
            <div
              className="sidebar-resize-handle"
              onMouseDown={handleSidebarResizeMouseDown}
            />
          )}
        </nav>
        {renderContent()}
      </div>
      <QueuePanel serverWithCred={serverWithCred ?? undefined} />
      {view !== "nowplaying" && (
        <PlayerBar
          onNowPlaying={() => navigateTo("nowplaying")}
          onSelectArtist={(name: string) => openArtist({ name, album_count: 0, artwork_url: null })}
          onSelectAlbumById={async (albumId: string) => {
            const db = await getDb();
            const rows = await db.select<AlbumRow[]>("SELECT * FROM albums WHERE id = ?", [albumId]);
            if (rows[0]) openAlbum(rows[0]);
          }}
          serverWithCred={serverWithCred ?? undefined}
        />
      )}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(v) => { navigateTo(v); setCommandPaletteOpen(false); }}
        onSelectAlbum={(album) => { openAlbum(album); setCommandPaletteOpen(false); }}
        onSelectArtist={(name, albumCount) => { openArtist({ name, album_count: albumCount, artwork_url: null }); setCommandPaletteOpen(false); }}
        onPlayTrack={(id) => { void handlePlayTrack(id); setCommandPaletteOpen(false); }}
        serverWithCredential={serverWithCred ?? undefined}
      />
      {pendingUpdate && (
        <UpdatePrompt
          update={pendingUpdate}
          onDismiss={() => setPendingUpdate(null)}
        />
      )}
      {feedbackOpen && (
        <FeedbackModal
          serverUrl={server?.url}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </Suspense>
  );
}
