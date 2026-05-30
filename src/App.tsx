import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Music, Users, Tag, Settings, Heart, Search, X, ListMusic, Headphones, House } from "lucide-react";
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
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
const NowPlayingView = lazy(() => import("./components/NowPlayingView").then((m) => ({ default: m.NowPlayingView })));
import { useServers, useServerWithCredential } from "./hooks/useServer";
import { useAlbums } from "./hooks/useAlbums";
import { useArtists } from "./hooks/useArtists";
import { useGenres } from "./hooks/useGenres";
import { useLoved } from "./hooks/useLoved";
import { useSearch } from "./hooks/useSearch";
import { useSetting } from "./hooks/useSetting";
import { usePlaylists } from "./hooks/usePlaylists";
import type { PlaylistRow } from "./hooks/usePlaylists";
import { useScrobbleFlush } from "./hooks/useScrobbleFlush";
import { useVocabulary } from "./hooks/useTagMappings";
import { useMediaSession } from "./hooks/useMediaSession";
import { useRadio } from "./hooks/useRadio";
import { useBackgroundNormalizer } from "./hooks/useBackgroundNormalizer";
import { syncLibrary } from "./lib/sync";
import { getCoverArtUrl, getStreamUrl } from "./lib/navidrome";
import { stripServerPrefix } from "./lib/ids";
import { getDb } from "./db";
import { useTrackEndedListener } from "./hooks/useTrackEndedListener";
import { useScrobble } from "./hooks/useScrobble";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { usePlayerStore } from "./store/player";
import type { RadioMode, CurrentTrack } from "./store/player";
import { extractAccent } from "./lib/artColor";
import type { Server } from "./types/server";
import type { AlbumRow } from "./hooks/useAlbums";
import type { AlbumSort } from "./hooks/useAlbums";
import type { ArtistRow } from "./hooks/useArtists";
import "./styles/tokens.css";
import "./styles/library.css";
import "./styles/base.css";
import "./App.css";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";
type View = "home" | "nowplaying" | "library" | "artists" | "playlists" | "tags" | "settings";

export default function App() {
  useTrackEndedListener();
  useMediaSession();
  useRadio();
  useBackgroundNormalizer();
  const loadSettings = usePlayerStore((s) => s.loadSettings);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const elapsed = usePlayerStore((s) => s.elapsed);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  useScrobble(currentTrack, elapsed);

  const { data: servers, isLoading: serversLoading } = useServers();
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>("home");
  const [lovedOnly, setLovedOnly] = useState(false);
  const { lovedAlbumIds } = useLoved();

  const [rawSort, setSort] = useSetting("library_sort", "artist");
  const sort = (["artist", "alphabetical", "year", "recently_added"].includes(rawSort)
    ? rawSort
    : "artist") as AlbumSort;
  const [canonicalIdFilters, setCanonicalIdFilters] = useState<string[]>([]);
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const genreDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!genreDropdownOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (genreDropdownRef.current && !genreDropdownRef.current.contains(e.target as Node)) {
        setGenreDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [genreDropdownOpen]);

  const [selectedArtist, setSelectedArtist] = useState<ArtistRow | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistRow | null>(null);
  const { data: playlists, createPlaylist, deletePlaylist } = usePlaylists();

  const [searchRaw, setSearchRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: searchResults } = useSearch(searchQuery);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

  const setAccentColor = usePlayerStore((s) => s.setAccentColor);

  const play = usePlayerStore((s) => s.play);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const setStreamUrlFor = usePlayerStore((s) => s.setStreamUrlFor);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const server = servers?.[0];
  const { data: serverWithCred, error: credError } = useServerWithCredential(server?.id);
  useGlobalShortcuts(serverWithCred);
  useScrobbleFlush(serverWithCred);
  const { data: albums } = useAlbums(sort, canonicalIdFilters);
  const { data: artists } = useArtists();
  const { data: genres } = useGenres();
  const { data: vocab } = useVocabulary();
  const unmappedCount = vocab?.filter((r) => !r.canonical_id).length ?? 0;

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
    if (!artUrl) { setAccentColor(null); return; }
    let cancelled = false;
    void extractAccent(artUrl).then((color) => {
      if (!cancelled) setAccentColor(color);
    });
    return () => { cancelled = true; };
  }, [currentTrack?.coverArtUrl, setAccentColor]);

  const NAV_ITEMS: { id: View; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "home", label: "Home", icon: <House size={24} /> },
    { id: "nowplaying", label: "Now Playing", icon: <Headphones size={24} /> },
    { id: "library", label: "Library", icon: <Music size={24} /> },
    { id: "artists", label: "Artists", icon: <Users size={24} /> },
    { id: "playlists", label: "Playlists", icon: <ListMusic size={24} /> },
    { id: "tags", label: "Tags", icon: <Tag size={24} />, badge: unmappedCount || undefined },
    { id: "settings", label: "Settings", icon: <Settings size={24} /> },
  ];

  const syncedRef = useRef<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string>("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumRow | null>(null);

  function navigateTo(v: View, select?: { album?: AlbumRow; artist?: ArtistRow }) {
    if (v === "nowplaying" && isQueueOpen) toggleQueue();
    setView(v);
    setSelectedAlbum(select?.album ?? null);
    setSelectedArtist(select?.artist ?? null);
    setSelectedPlaylist(null);
    setCanonicalIdFilters([]);
  }

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
    type AlbumRow = { artwork_url: string | null; name: string };
    const albumRows = await db.select<AlbumRow[]>(
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

  function runSync(s: Server) {
    setSyncStatus("syncing");
    setSyncError("");
    syncLibrary(s)
      .then(({ failedAlbums, failedPlaylists }) => {
        const hasPartialFailure = failedAlbums > 0 || failedPlaylists > 0;
        setSyncStatus(hasPartialFailure ? "partial" : "done");
        setLastSyncedAt(Date.now());
        if (hasPartialFailure) {
          const parts = [];
          if (failedAlbums > 0) parts.push(`${failedAlbums} album${failedAlbums > 1 ? "s" : ""}`);
          if (failedPlaylists > 0) parts.push(`${failedPlaylists} playlist${failedPlaylists > 1 ? "s" : ""}`);
          setSyncError(`Sync partial — failed to fetch tracks for ${parts.join(" and ")}.`);
        }
        void queryClient.invalidateQueries({ queryKey: ["albums"] });
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["artists"] });
          void queryClient.invalidateQueries({ queryKey: ["genres"] });
        }, 300);
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["loved_tracks"] });
          void queryClient.invalidateQueries({ queryKey: ["loved_albums"] });
          void queryClient.invalidateQueries({ queryKey: ["playlists"] });
        }, 600);
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["tag_issues"] });
        }, 1000);
      })
      .catch((err: unknown) => {
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
        console.error("Sync failed:", err);
      });
  }

  useEffect(() => {
    if (!server || syncedRef.current === server.id) return;
    syncedRef.current = server.id;
    runSync(server);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  if (serversLoading) return null;

  if (!servers || servers.length === 0) {
    return (
      <Suspense fallback={null}>
        <Wizard
          onSuccess={(newServer: Server) => {
            queryClient.setQueryData(["servers"], [newServer]);
          }}
        />
      </Suspense>
    );
  }

  function renderLibraryContent() {
    if (!serverWithCred || albums === undefined) {
      return <p className="empty-state">Loading…</p>;
    }
    if (selectedAlbum) {
      return (
        <AlbumDetail
          album={selectedAlbum}
          serverWithCredential={serverWithCred}
          onClose={() => setSelectedAlbum(null)}
          onTagFilter={(canonicalId) => { setCanonicalIdFilters([canonicalId]); setSelectedAlbum(null); }}
        />
      );
    }
    if (searchQuery && searchResults) {
      return (
        <SearchResults
          albums={searchResults.albums}
          tracks={searchResults.tracks}
          artists={searchResults.artists}
          serverWithCredential={serverWithCred}
          onSelectAlbum={(album) => {
            clearSearch();
            setSelectedAlbum(album);
          }}
          onPlayTrack={(id) => { void handlePlayTrack(id); }}
        />
      );
    }
    if (searchQuery && !searchResults) {
      return <p className="empty-state">Searching…</p>;
    }
    const visibleAlbums = lovedOnly
      ? albums.filter((a) => lovedAlbumIds.has(a.id))
      : albums;
    const filtersActive = lovedOnly || canonicalIdFilters.length > 0;
    const emptyMessage = lovedOnly
      ? "No loved albums"
      : filtersActive
        ? "No albums match this filter"
        : "No albums yet. Syncing…";
    return (
      <AlbumGrid
        albums={visibleAlbums}
        serverWithCredential={serverWithCred}
        onSelect={setSelectedAlbum}
        onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
        emptyMessage={emptyMessage}
        scrollKey={`library-${sort}-${lovedOnly ? "loved" : ""}-${canonicalIdFilters.join(",")}`}
        sort={sort}
      />
    );
  }

  const queueClass = isQueueOpen ? " library--queue-open" : "";

  function renderAlbumDetail() {
    if (!selectedAlbum || !serverWithCred) return null;
    return (
      <AlbumDetail
        album={selectedAlbum}
        serverWithCredential={serverWithCred}
        onClose={() => setSelectedAlbum(null)}
        onTagFilter={(canonicalId) => { setCanonicalIdFilters([canonicalId]); setSelectedAlbum(null); }}
      />
    );
  }

  const SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
    { value: "recently_added", label: "Recent" },
    { value: "artist", label: "Artist" },
    { value: "alphabetical", label: "A–Z" },
    { value: "year", label: "Year" },
  ];

  function toggleGenreFilter(id: string) {
    setCanonicalIdFilters((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

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

  function renderContent() {
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
              onSelectAlbum={(album) => {
                clearSearch();
                setSelectedAlbum(album);
                setView("library");
              }}
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
                onSelectAlbum={(album) => navigateTo("library", { album })}
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
                onBack={() => navigateTo("library")}
              />
            ) : <main className="content-main" />}
          </Suspense>
        );

      case "library":
        return (
          <main className={`library${queueClass}`}>
            <header className="library-header">
              <h1>Canon</h1>
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
                          onClick={() => toggleGenreFilter(g.canonical_id)}
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
                onClick={() => setLovedOnly((v) => !v)}
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
            </header>
            {renderLibraryContent()}
          </main>
        );

      case "artists":
        return (
          <main className={`library${queueClass}`}>
            {selectedAlbum && serverWithCred ? (
              renderAlbumDetail()
            ) : selectedArtist && serverWithCred ? (
              <ArtistDetail
                artist={selectedArtist}
                serverWithCredential={serverWithCred}
                onClose={() => setSelectedArtist(null)}
                onSelectAlbum={setSelectedAlbum}
              />
            ) : (
              <>
                <header className="library-header">
                  <h1>Artists</h1>
                  <span className="server-name">{server?.display_name}</span>
                </header>
                {serverWithCred ? (
                  <ArtistGrid
                    artists={artists ?? []}
                    serverWithCredential={serverWithCred}
                    onSelect={setSelectedArtist}
                    onStartRadio={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
                    scrollKey="artists"
                  />
                ) : (
                  <p className="empty-state">Loading…</p>
                )}
              </>
            )}
          </main>
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
            />
          </main>
        );
    }
  }

  return (
    <Suspense fallback={null}>
      <div className="app-layout">
        <nav className="sidebar">
          {NAV_ITEMS.map(({ id, label, icon, badge }) => (
            <button
              key={id}
              className={`sidebar-btn${view === id ? " sidebar-btn--active" : ""}`}
              title={badge ? `${label} (${badge} unmapped)` : label}
              onClick={() => navigateTo(id)}
            >
              <span className="sidebar-btn-icon">
                {icon}
                {badge ? <span className="sidebar-badge">{badge > 99 ? "99+" : badge}</span> : null}
              </span>
              <span className="sidebar-btn-label">{label}</span>
            </button>
          ))}
        </nav>
        {renderContent()}
      </div>
      <QueuePanel serverWithCred={serverWithCred ?? undefined} />
      {view !== "nowplaying" && (
        <PlayerBar onNowPlaying={() => navigateTo("nowplaying")} serverWithCred={serverWithCred ?? undefined} />
      )}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(v) => { navigateTo(v); setCommandPaletteOpen(false); }}
        onSelectAlbum={(album) => { setSelectedAlbum(album); navigateTo("library"); setCommandPaletteOpen(false); }}
        onPlayTrack={(id) => { void handlePlayTrack(id); setCommandPaletteOpen(false); }}
        serverWithCredential={serverWithCred ?? undefined}
      />
    </Suspense>
  );
}
