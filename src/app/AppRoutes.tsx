import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { Search, LayoutList } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { AlbumGrid } from "../components/AlbumGrid";
import { FilterSidebar } from "../components/FilterSidebar";
import { CanonLockup } from "../components/CanonIcon";
import { getDb } from "../db";
import type { AlbumRow, AlbumSort, ArtistRow } from "../types/library";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "../hooks/useServer";
import type { PlaylistRow, usePlaylists } from "../hooks/usePlaylists";
import type { useLibrarySync } from "../hooks/useLibrarySync";
import type { useGenres } from "../hooks/useGenres";
import type { useAllTracks } from "../hooks/useAllTracks";
import { useAllTracksSessionStore } from "../store/allTracksSessionStore";
import type { SearchResults as SearchResultsData } from "../hooks/useSearch";
import type { AppView } from "../hooks/useAppNavigation";
import type { RadioMode, CurrentTrack } from "../store/player";

const ArtistGridLazy = lazy(() => import("../components/ArtistGrid").then((m) => ({ default: m.ArtistGrid })));
import type { RemoteNotice } from "../lib/notice";

const AlbumDetail = lazy(() => import("../components/AlbumDetail").then((m) => ({ default: m.AlbumDetail })));
const ArtistDetail = lazy(() => import("../components/ArtistDetail").then((m) => ({ default: m.ArtistDetail })));
const PlaylistDetail = lazy(() => import("../components/PlaylistDetail").then((m) => ({ default: m.PlaylistDetail })));
const PlaylistList = lazy(() => import("../components/PlaylistList").then((m) => ({ default: m.PlaylistList })));
const SearchResults = lazy(() => import("../components/SearchResults").then((m) => ({ default: m.SearchResults })));
const SettingsView = lazy(() => import("../components/SettingsView").then((m) => ({ default: m.SettingsView })));
const TagsView = lazy(() => import("../components/TagsView").then((m) => ({ default: m.TagsView })));
const UnidentifiedView = lazy(() => import("../components/UnidentifiedView").then((m) => ({ default: m.UnidentifiedView })));
const HomeView = lazy(() => import("../components/HomeView").then((m) => ({ default: m.HomeView })));
const GenreView = lazy(() => import("../components/GenreView").then((m) => ({ default: m.GenreView })));
const YearsView = lazy(() => import("../components/YearsView").then((m) => ({ default: m.YearsView })));
const TrackTableView = lazy(() => import("../components/TrackTableView").then((m) => ({ default: m.TrackTableView })));
const NowPlayingView = lazy(() => import("../components/NowPlayingView").then((m) => ({ default: m.NowPlayingView })));

type PlaylistApi = ReturnType<typeof usePlaylists>;
type SyncApi = ReturnType<typeof useLibrarySync>;

export interface NavItem {
  id: AppView;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

/**
 * Single computed props bag threaded from App (MainApp role) through AppShell
 * into AppRoutes. App owns every hook/state/handler; the shell and route tree
 * are pure presentational splits that consume this. Passed by spread so the
 * field set is declared once and tsc verifies App supplies all of it.
 */
export interface AppViewProps {
  // Server / data
  server: Server | undefined;
  serverWithCred: ServerWithCredential | null;
  albums: AlbumRow[] | undefined;
  visibleAlbums: AlbumRow[];
  artists: ArtistRow[] | undefined;
  allTracks: ReturnType<typeof useAllTracks>["data"];
  allTracksLoading: boolean;
  allTracksError: string | null;
  genres: ReturnType<typeof useGenres>["data"];
  playlists: PlaylistRow[] | undefined;
  searchResults: SearchResultsData | undefined;
  searchError: boolean;

  // Library filters
  canonicalIdFilters: string[];
  lovedOnly: boolean;
  yearFromInput: string;
  yearToInput: string;
  setCanonicalIdFilters: (ids: string[]) => void;
  toggleCanonicalIdFilter: (id: string) => void;
  toggleLovedOnly: () => void;
  setYearFromInput: (v: string) => void;
  setYearToInput: (v: string) => void;
  filterSidebarOpen: boolean;
  setFilterSidebarOpen: (v: boolean) => Promise<void>;

  // Sort / pagination
  sort: AlbumSort;
  setSort: (v: string) => Promise<void>;
  albumsPaginated: boolean;
  setAlbumsPaginated: (v: boolean) => Promise<void>;

  // Sync status
  syncStatus: SyncApi["syncStatus"];
  syncError: SyncApi["syncError"];
  syncProgress: SyncApi["syncProgress"];
  lastSyncedAt: SyncApi["lastSyncedAt"];
  runSync: SyncApi["runSync"];
  credError: Error | null;

  // Search
  searchOpen: boolean;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchRaw: string;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  handleSearchChange: (v: string) => void;
  clearSearch: () => void;

  // Home search
  homeSearchRaw: string;
  homeSearchQuery: string;
  setHomeSearchRaw: React.Dispatch<React.SetStateAction<string>>;

  // Navigation
  view: AppView;
  navigateTo: (v: AppView, select?: { album?: AlbumRow; artist?: ArtistRow }) => void;
  openAlbum: (album: AlbumRow) => void;
  openArtist: (artist: ArtistRow | string) => void;
  openPlaylist: (playlist: PlaylistRow) => void;
  openAlbumById: (albumId: string) => void | Promise<void>;
  goBack: () => void;

  // Playback handlers
  handlePlayTrack: (trackId: string) => Promise<void>;
  handleStartRadioFromAlbum: (album: AlbumRow, mode: RadioMode) => Promise<void>;
  handleStartRadioFromArtist: (artist: ArtistRow, mode: RadioMode) => Promise<void>;
  handleAddAlbumToQueue: (album: AlbumRow) => Promise<void>;
  handlePlayGenre: (canonicalId: string, label?: string) => Promise<void>;

  // Playlist mutations
  addAlbumToPlaylist: PlaylistApi["addAlbumToPlaylist"];
  createPlaylist: PlaylistApi["createPlaylist"];
  createSmartPlaylist: PlaylistApi["createSmartPlaylist"];
  deletePlaylist: PlaylistApi["deletePlaylist"];
  renamePlaylist: PlaylistApi["renamePlaylist"];
  setCustomCover: PlaylistApi["setCustomCover"];
  refreshSmartPlaylist: PlaylistApi["refreshSmartPlaylist"];
  updateSmartPlaylistRules: PlaylistApi["updateSmartPlaylistRules"];

  // Chrome / overlays
  queueClass: string;
  hideTagBadge: boolean;
  setHideTagBadge: (v: boolean) => Promise<void>;
  queryClient: QueryClient;
  currentTrack: CurrentTrack | null;
  metaBarVisible: boolean;
  navItems: NavItem[];
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  feedbackOpen: boolean;
  setFeedbackOpen: React.Dispatch<React.SetStateAction<boolean>>;
  crashReport: string | null;
  setCrashReport: React.Dispatch<React.SetStateAction<string | null>>;
  pendingUpdate: Update | null;
  setPendingUpdate: React.Dispatch<React.SetStateAction<Update | null>>;
  remoteNotice: RemoteNotice | null;
  setRemoteNotice: React.Dispatch<React.SetStateAction<RemoteNotice | null>>;
  setLastSeenNoticeId: (v: string) => Promise<void>;

  // Sidebar
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => Promise<void>;
  sidebarLiveWidth: number | null;
  sidebarWidth: number;
  handleSidebarResizeMouseDown: (e: React.MouseEvent) => void;
}

function AlbumDetailRoute({
  serverWithCred,
  onSelectAlbum,
  onSelectArtist,
  onTagFilter,
  onClose,
  queueClass,
}: {
  serverWithCred: ServerWithCredential | null;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string) => void;
  onTagFilter: (canonicalId: string) => void;
  onClose: () => void;
  queueClass: string;
}) {
  const { albumId } = useParams<{ albumId: string }>();
  const { data: fetchedAlbum } = useQuery<AlbumRow | null>({
    queryKey: ["album-by-id", albumId],
    enabled: !!albumId,
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type, accent_color FROM albums WHERE id = ?`,
        [decodeURIComponent(albumId!)]
      );
      return rows[0] ?? null;
    },
  });
  const album = fetchedAlbum ?? null;
  if (!album || !serverWithCred) return null;
  return (
    <main className={`library${queueClass}`}>
      <AlbumDetail
        album={album}
        serverWithCredential={serverWithCred}
        onClose={onClose}
        onSelectAlbum={onSelectAlbum}
        onSelectArtist={onSelectArtist}
        onTagFilter={onTagFilter}
      />
    </main>
  );
}

function ArtistDetailRoute({
  serverWithCred,
  onSelectAlbum,
  onSelectArtist,
  onClose,
  queueClass,
}: {
  serverWithCred: ServerWithCredential | null;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string) => void;
  onClose: () => void;
  queueClass: string;
}) {
  const { artistName } = useParams<{ artistName: string }>();
  const decodedName = artistName ? decodeURIComponent(artistName) : null;
  const { data: fetchedArtist, isPending: artistPending } = useQuery<ArtistRow | null>({
    queryKey: ["artist-by-name", artistName, serverWithCred?.server.id],
    enabled: !!artistName && !!serverWithCred,
    queryFn: async () => {
      const db = await getDb();
      const serverId = serverWithCred!.server.id;
      // Matched case-insensitively because the name in the URL can come from a
      // Last.fm similar-artist card, whose spelling drifts from the local one
      // ("Tyler, The Creator" vs "Tyler, the Creator"). `a.name` is selected, so
      // everything downstream queries with the library's own spelling and finds
      // the artist's albums and tracks.
      const rows = await db.select<ArtistRow[]>(
        `SELECT a.name, a.album_count,
           (SELECT al.artwork_url FROM albums al
            WHERE al.artist = a.name AND al.server_id = a.server_id AND al.artwork_url IS NOT NULL
            LIMIT 1) AS artwork_url,
           ai.lastfm_image_url,
           ai.wikidata_image_url
         FROM artists a
         LEFT JOIN artist_identity ai ON ai.artist_name = a.name
         WHERE LOWER(TRIM(a.name)) = LOWER(TRIM(?)) AND a.server_id = ?`,
        [decodedName!, serverId]
      );
      return rows[0] ?? null;
    },
  });
  if (!serverWithCred || !decodedName) return null;
  // Held until the lookup settles: `data` is undefined while pending as well as
  // when the artist is genuinely absent, so rendering the fallback immediately
  // painted a library artist's hero as "0 albums in library" with no portrait
  // for the length of the query, then swapped it out.
  if (artistPending) return <main className={`library${queueClass}`} />;
  // Recommended/similar artists surfaced in an artist view are not in the local
  // `artists` table, so the lookup above misses. Fall back to a minimal row
  // synthesized from the URL name (same shape openArtist(string) builds) so
  // ArtistDetail still renders and can enrich/look up by name, instead of
  // hard-returning null (which painted a black screen).
  const artist: ArtistRow = fetchedArtist ?? {
    name: decodedName,
    album_count: 0,
    artwork_url: null,
    lastfm_image_url: null,
    wikidata_image_url: null,
    navidrome_image_url: null,
    enriched_at: null,
  };
  return (
    <main className={`library${queueClass}`}>
      <ArtistDetail
        key={artist.name}
        artist={artist}
        serverWithCredential={serverWithCred}
        onClose={onClose}
        onSelectAlbum={onSelectAlbum}
        onSelectArtist={onSelectArtist}
      />
    </main>
  );
}

function PlaylistDetailRoute({
  serverWithCred,
  onSelectAlbum,
  onSelectArtist,
  onClose,
  queueClass,
  deletePlaylist,
  renamePlaylist,
  setCustomCover,
  refreshSmartPlaylist,
  updateSmartPlaylistRules,
}: {
  serverWithCred: ServerWithCredential | null;
  onSelectAlbum: (albumId: string) => void;
  onSelectArtist: (name: string) => void;
  onClose: () => void;
  queueClass: string;
  deletePlaylist: PlaylistApi["deletePlaylist"];
  renamePlaylist: PlaylistApi["renamePlaylist"];
  setCustomCover: PlaylistApi["setCustomCover"];
  refreshSmartPlaylist: PlaylistApi["refreshSmartPlaylist"];
  updateSmartPlaylistRules: PlaylistApi["updateSmartPlaylistRules"];
}) {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { data: playlist } = useQuery<PlaylistRow | null>({
    queryKey: ["playlist-by-id", playlistId],
    enabled: !!playlistId,
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<PlaylistRow[]>(
        `SELECT id, server_id, name, comment, track_count, cover_art_url, custom_cover_data, is_smart, rules_json FROM playlists WHERE id = ?`,
        [decodeURIComponent(playlistId!)]
      );
      return rows[0] ?? null;
    },
  });
  if (!playlist || !serverWithCred) return null;
  return (
    <main className={`library${queueClass}`}>
      <PlaylistDetail
        playlist={playlist}
        serverWithCredential={serverWithCred}
        onClose={onClose}
        onDelete={async () => {
          await deletePlaylist(playlist, serverWithCred);
          navigate("/playlists");
        }}
        onRename={renamePlaylist}
        onRefreshSmart={refreshSmartPlaylist}
        onUpdateSmartRules={updateSmartPlaylistRules}
        onSetCustomCover={setCustomCover}
        onSelectAlbum={onSelectAlbum}
        onSelectArtist={onSelectArtist}
      />
    </main>
  );
}

const SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
  { value: "recently_added", label: "Recent" },
  { value: "artist", label: "Artist" },
  { value: "alphabetical", label: "A-Z" },
  { value: "year", label: "Year" },
];

export function AppRoutes(props: AppViewProps) {
  const {
    server,
    serverWithCred,
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
    runSync,
    credError,
    searchOpen,
    setSearchOpen,
    searchRaw,
    searchQuery,
    searchInputRef,
    clearSearch,
    homeSearchRaw,
    homeSearchQuery,
    setHomeSearchRaw,
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
    queryClient,
    lastSyncedAt,
    hideTagBadge,
    setHideTagBadge,
    setCommandPaletteOpen,
  } = props;

  function renderLibraryContent() {
    if (!serverWithCred || albums === undefined) {
      return <p className="empty-state">Loading…</p>;
    }
    if (searchQuery && searchError) {
      return <p className="empty-state">Search failed. The library database could not be read.</p>;
    }
    if (searchQuery && searchResults) {
      return (
        <SearchResults
          albums={searchResults.albums}
          tracks={searchResults.tracks}
          artists={searchResults.artists}
          serverWithCredential={serverWithCred}
          playlists={playlists}
          onSelectAlbum={openAlbum}
          onSelectArtist={(artist) => { clearSearch(); navigateTo("artists", { artist: { name: artist.name, album_count: artist.album_count, artwork_url: null, lastfm_image_url: null, wikidata_image_url: null, navidrome_image_url: null, enriched_at: null } }); }}
          onPlayTrack={(id) => { void handlePlayTrack(id); }}
          onStartRadioFromAlbum={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
          onStartRadioFromArtist={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
          onAddAlbumToPlaylist={serverWithCred ? (album, pl) => { void addAlbumToPlaylist(pl, album.id, serverWithCred); } : undefined}
        />
      );
    }
    if (searchQuery && !searchResults) {
      return <p className="empty-state">Searching…</p>;
    }
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
        onAddAlbumToQueue={(album) => { void handleAddAlbumToQueue(album); }}
        onAddAlbumToPlaylist={serverWithCred ? (album, pl) => { void addAlbumToPlaylist(pl, album.id, serverWithCred); } : undefined}
        playlists={playlists}
        emptyMessage={emptyMessage}
        sort={sort}
      />
    );
  }

  return (
    <Routes>
      <Route path="/album/:albumId" element={
        <AlbumDetailRoute
          serverWithCred={serverWithCred}
          onSelectAlbum={openAlbum}
          onSelectArtist={openArtist}
          onTagFilter={(canonicalId) => { setCanonicalIdFilters([canonicalId]); navigateTo("library"); }}
          onClose={goBack}
          queueClass={queueClass}
        />
      } />
      <Route path="/artist/:artistName" element={
        <ArtistDetailRoute
          serverWithCred={serverWithCred}
          onSelectAlbum={openAlbum}
          onSelectArtist={openArtist}
          onClose={goBack}
          queueClass={queueClass}
        />
      } />
      <Route path="/playlist/:playlistId" element={
        <PlaylistDetailRoute
          serverWithCred={serverWithCred}
          onSelectAlbum={(albumId) => { void openAlbumById(albumId); }}
          onSelectArtist={openArtist}
          onClose={goBack}
          queueClass={queueClass}
          deletePlaylist={deletePlaylist}
          renamePlaylist={renamePlaylist}
          setCustomCover={setCustomCover}
          refreshSmartPlaylist={refreshSmartPlaylist}
          updateSmartPlaylistRules={updateSmartPlaylistRules}
        />
      } />
      <Route path="/home" element={
        <Suspense fallback={null}>
          {serverWithCred ? (
            <HomeView
              serverWithCredential={serverWithCred}
              onSelectAlbum={openAlbum}
              onSelectArtist={openArtist}
              onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
              onStartRadioFromArtist={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
              onPlayTrack={(id) => { void handlePlayTrack(id); }}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
              homeSearchRaw={homeSearchRaw}
              homeSearchQuery={homeSearchQuery}
              onHomeSearchRawChange={setHomeSearchRaw}
            />
          ) : <main className="content-main" />}
        </Suspense>
      } />
      <Route path="/nowplaying" element={
        <Suspense fallback={null}>
          {serverWithCred ? (
            <NowPlayingView
              serverWithCredential={serverWithCred}
              onSelectAlbum={(album) => openAlbum(album)}
              onSelectArtist={openArtist}
              onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
              onBack={goBack}
            />
          ) : <main className="content-main" />}
        </Suspense>
      } />
      <Route path="/library" element={
        <main className={`library${queueClass}`}>
          <header className="library-header library-header--browse">
            <div className="library-header-zone library-header-zone--start">
              <CanonLockup height={22} className="library-header-logo" />
              <span className="server-name">{server?.display_name}</span>
              {syncStatus === "syncing" && (
                <span className="sync-status">
                  {syncProgress && syncProgress.total > 0
                    ? `Syncing ${syncProgress.done} of ${syncProgress.total} albums…`
                    : "Syncing…"}
                </span>
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
            </div>
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
            <div className="library-header-zone library-header-zone--end">
              <button
                className="search-trigger-btn"
                onClick={() => { if (searchOpen || searchRaw) { clearSearch(); } else { setSearchOpen(true); setTimeout(() => { searchInputRef.current?.focus(); }, 0); } }}
                title="Search (Ctrl+F)"
              >
                <Search size={15} />
                Search…
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
                className={`header-toggle-btn${albumsPaginated ? " header-toggle-btn--active" : ""}`}
                onClick={() => void setAlbumsPaginated(!albumsPaginated)}
                title={albumsPaginated ? "Switch to scroll view" : "Switch to page view"}
              >
                <LayoutList size={14} />
                Pages
              </button>
            </div>
          </header>
          <div className="library-body">
            <FilterSidebar
              genres={genres ?? []}
              canonicalIdFilters={canonicalIdFilters}
              toggleCanonicalIdFilter={toggleCanonicalIdFilter}
              clearGenreFilters={() => setCanonicalIdFilters([])}
              yearFromInput={yearFromInput}
              yearToInput={yearToInput}
              setYearFromInput={setYearFromInput}
              setYearToInput={setYearToInput}
              lovedOnly={lovedOnly}
              toggleLovedOnly={toggleLovedOnly}
              isOpen={filterSidebarOpen}
              onToggle={() => void setFilterSidebarOpen(!filterSidebarOpen)}
            />
            <div className="library-content">
              {renderLibraryContent()}
            </div>
          </div>
        </main>
      } />
      <Route path="/artists" element={
        <main className={`library${queueClass}`}>
          <header className="library-header">
            <h1>Artists</h1>
            <span className="server-name">{server?.display_name}</span>
          </header>
          {serverWithCred ? (
            <ArtistGridLazy
              artists={artists ?? []}
              serverWithCredential={serverWithCred}
              onSelect={openArtist}
              onStartRadio={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
            />
          ) : (
            <p className="empty-state">Loading…</p>
          )}
        </main>
      } />
      <Route path="/genres" element={
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
      } />
      <Route path="/years" element={
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
      } />
      <Route path="/playlists" element={
        <main className={`library${queueClass}`}>
          <header className="library-header">
            <h1>Playlists</h1>
            <span className="server-name">{server?.display_name}</span>
          </header>
          {serverWithCred ? (
            <PlaylistList
              playlists={playlists}
              serverWithCredential={serverWithCred}
              onSelect={openPlaylist}
              onCreatePlaylist={createPlaylist}
              onCreateSmartPlaylist={createSmartPlaylist}
              onDelete={(pl) => deletePlaylist(pl, serverWithCred)}
              onRename={renamePlaylist}
              onUpdateSmartRules={updateSmartPlaylistRules}
              onSetCustomCover={setCustomCover}
            />
          ) : (
            <p className="empty-state">Loading…</p>
          )}
        </main>
      } />
      <Route path="/tracks" element={
        <Suspense fallback={null}>
          {serverWithCred ? (
            <TrackTableView
              serverWithCredential={serverWithCred}
              tracks={allTracks}
              isLoading={allTracksLoading}
              error={allTracksError}
              onRetry={() => useAllTracksSessionStore.getState().bumpRefresh()}
              onSelectAlbum={(albumId) => { void openAlbumById(albumId); }}
              onSelectArtist={openArtist}
            />
          ) : <main className="content-main" />}
        </Suspense>
      } />
      <Route path="/tags" element={
        <Suspense fallback={null}>
          <TagsView />
        </Suspense>
      } />
      <Route path="/unidentified" element={
        <Suspense fallback={null}>
          {serverWithCred ? (
            <UnidentifiedView
              serverWithCredential={serverWithCred}
              onSelectAlbum={openAlbum}
            />
          ) : <main className="content-main" />}
        </Suspense>
      } />
      <Route path="/settings" element={
        <main className="content-main">
          <SettingsView
            server={server}
            syncStatus={syncStatus}
            syncError={syncError}
            lastSyncedAt={lastSyncedAt}
            serverWithCredential={serverWithCred ?? undefined}
            onRemoveServer={() => {
              queryClient.setQueryData(["servers"], []);
            }}
            hideTagBadge={hideTagBadge}
            setHideTagBadge={setHideTagBadge}
          />
        </main>
      } />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
