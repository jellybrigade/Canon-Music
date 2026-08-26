import React, { Suspense, lazy, useMemo } from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { Search, LayoutList } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { AlbumGrid } from "../components/AlbumGrid";
import { FilterSidebar } from "../components/FilterSidebar";
import { CanonLockup } from "../components/CanonIcon";
import { SyncErrorBanner } from "../components/SyncErrorBanner";
import { getDb } from "../db";
import type { AlbumRow, AlbumSort, ArtistRow } from "../types/library";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "../hooks/useServer";
import type { PlaylistRow, usePlaylists } from "../hooks/usePlaylists";
import type { useLibrarySync } from "../hooks/useLibrarySync";
import type { useGenres } from "../hooks/useGenres";
import type { useAllTracks } from "../hooks/useAllTracks";
import { useAllTracksSessionStore } from "../store/allTracksSessionStore";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import { useArtistBrowseSessionStore } from "../store/artistBrowseSessionStore";
import type { SearchResults as SearchResultsData } from "../hooks/useSearch";
import type { AppView } from "../hooks/useAppNavigation";
import type { RadioMode, CurrentTrack } from "../store/player";

const ArtistGridLazy = lazy(() => import("../components/ArtistGrid").then((m) => ({ default: m.ArtistGrid })));
import type { RemoteNotice } from "../lib/notice";

const AlbumDetail = lazy(() => import("../components/AlbumDetail").then((m) => ({ default: m.AlbumDetail })));
const ArtistDetail = lazy(() => import("../components/ArtistDetail").then((m) => ({ default: m.ArtistDetail })));
const PlaylistDetail = lazy(() => import("../components/PlaylistDetail").then((m) => ({ default: m.PlaylistDetail })));
const PlaylistList = lazy(() => import("../components/PlaylistList").then((m) => ({ default: m.PlaylistList })));
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
  albumsLoading: boolean;
  albumsError: string | null;
  visibleAlbums: AlbumRow[];
  artists: ArtistRow[] | undefined;
  artistsLoading: boolean;
  artistsError: string | null;
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
  nextRetryAt: SyncApi["nextRetryAt"];
  runSync: SyncApi["runSync"];
  credError: Error | null;
  credPending: boolean;

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

/**
 * What a detail route paints while it has no credential yet. All three of them need one before
 * they can render anything, and `serverWithCred` is null for the whole keychain round-trip as
 * well as for a read that failed - the same pending-vs-absent collapse the album lookup below
 * had, one prerequisite earlier. There is no "no server configured" case to express here:
 * `App` renders the setup wizard when the `servers` table is empty, so the router only mounts
 * with a server row present. And the credential query is `retry: false`, so a failure is
 * permanent rather than transient, which is why it gets a message pointing at the fix instead
 * of sitting on the loading state forever.
 *
 * Shared rather than written out three times because the two states have to stay in step; the
 * per-route copy below drifted for exactly this reason before it was consolidated.
 */
function CredentialGate({
  credError,
  credPending,
  queueClass,
}: {
  credError: Error | null;
  credPending: boolean;
  queueClass: string;
}) {
  return (
    <main className={`library${queueClass}`}>
      {credError || !credPending ? (
        <div className="empty-state">
          <p className="empty-state-title">Canon could not read the saved credential</p>
          <p className="empty-state-hint">
            {credError ? credError.message : "The stored credential could not be loaded."}
          </p>
          <p className="empty-state-hint">Re-enter your server password in Settings.</p>
        </div>
      ) : (
        <p className="empty-state">Connecting to your server…</p>
      )}
    </main>
  );
}

function AlbumDetailRoute({
  serverWithCred,
  credError,
  credPending,
  onSelectAlbum,
  onSelectArtist,
  onTagFilter,
  onClose,
  queueClass,
}: {
  serverWithCred: ServerWithCredential | null;
  credError: Error | null;
  credPending: boolean;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string) => void;
  onTagFilter: (canonicalId: string) => void;
  onClose: () => void;
  queueClass: string;
}) {
  const { albumId } = useParams<{ albumId: string }>();
  const { data: fetchedAlbum, isPending: albumPending } = useQuery<AlbumRow | null>({
    queryKey: ["album-by-id", albumId],
    enabled: !!albumId,
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type, accent_color FROM albums WHERE id = ?`,
        // `useParams` has already decoded the segment, so `albumId` is the id `albumPath`
        // encoded. Decoding again throws on an id holding a literal `%` and silently
        // rewrites one holding the text `%20` into a space.
        [albumId!]
      );
      return rows[0] ?? null;
    },
  });
  if (!serverWithCred) {
    return <CredentialGate credError={credError} credPending={credPending} queueClass={queueClass} />;
  }
  // `data` is undefined while the lookup is in flight as well as when the album is genuinely
  // absent from the mirror, so the old `fetchedAlbum ?? null` folded both into one bare
  // `return null` and painted a blank page for each. Same split, and the same copy shape, as
  // PlaylistDetailRoute below.
  if (!fetchedAlbum) {
    return (
      <main className={`library${queueClass}`}>
        {albumPending ? (
          <p className="empty-state">Loading album…</p>
        ) : (
          <p className="empty-state">
            That album is no longer here. It may have been removed from the server.
          </p>
        )}
      </main>
    );
  }
  return (
    <main className={`library${queueClass}`}>
      <AlbumDetail
        album={fetchedAlbum}
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
  credError,
  credPending,
  onSelectAlbum,
  onSelectArtist,
  onClose,
  queueClass,
}: {
  serverWithCred: ServerWithCredential | null;
  credError: Error | null;
  credPending: boolean;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string) => void;
  onClose: () => void;
  queueClass: string;
}) {
  const { artistName } = useParams<{ artistName: string }>();
  // `useParams` decodes the segment already, so this is the name `artistPath` encoded.
  // Decoding a second time threw `URIError` on any name holding a literal `%` - in the
  // render body, so it took the whole tree down, not just this route.
  const decodedName = artistName ?? null;
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
  if (!serverWithCred) {
    return <CredentialGate credError={credError} credPending={credPending} queueClass={queueClass} />;
  }
  if (!decodedName) return null;
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
  credError,
  credPending,
  playlists,
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
  credError: Error | null;
  credPending: boolean;
  playlists: PlaylistRow[] | undefined;
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
  // Resolved out of the same list the playlists view renders rather than through a second
  // query of its own. The previous `["playlist-by-id"]` key was outside `QK` and nothing
  // invalidated it, while every playlist mutation signals through the playlist session
  // store instead - so renaming, editing the description, setting a cover or refreshing a
  // smart playlist from this page left the row this component rendered untouched, and the
  // edit visibly reverted until the default staleTime lapsed.
  // Already decoded by `useParams`; see the note in `ArtistDetailRoute`.
  const decodedId = playlistId ?? null;
  const playlist = useMemo(
    () => (decodedId ? playlists?.find((p) => p.id === decodedId) ?? null : null),
    [playlists, decodedId]
  );
  if (!serverWithCred) {
    return <CredentialGate credError={credError} credPending={credPending} queueClass={queueClass} />;
  }
  if (!playlist) {
    return (
      <main className={`library${queueClass}`}>
        {playlists === undefined ? (
          <p className="empty-state">Loading playlist…</p>
        ) : (
          <p className="empty-state">
            That playlist is no longer here. It may have been deleted on the server.
          </p>
        )}
      </main>
    );
  }
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
    nextRetryAt,
    syncProgress,
    runSync,
    credError,
    credPending,
    searchOpen,
    setSearchOpen,
    searchRaw,
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
    // `albums === undefined` used to render a bare "Loading…" line, which a failed read
    // also reached (useAlbums left `data` undefined on error) and never left. The grid now
    // owns all three states, so a failure surfaces with a retry instead of a permanent wait.
    if (!serverWithCred) {
      return (
        <div className="empty-state">
          <p className="empty-state-title">No server connected</p>
          <p className="empty-state-hint">Add your Navidrome server in Settings to browse your library.</p>
        </div>
      );
    }
    // No search branch here on purpose: AppShell renders the search overlay in
    // place of the whole route tree while a search is active, so anything keyed
    // on searchQuery in this function is unreachable.
    const filtersActive = lovedOnly || canonicalIdFilters.length > 0 || yearFromInput !== "" || yearToInput !== "";
    const emptyMessage = lovedOnly
      ? {
          title: "No loved albums",
          hint: "Albums you heart show up here. Hover any album's cover and click the heart to add one.",
        }
      : filtersActive
        ? {
            title: "No albums match this filter",
            hint: "Widen or clear the genre, year and loved filters in the sidebar to see more.",
          }
        : {
            title: "No albums yet",
            hint: "Sync your library from Settings and every album on your server fills this grid.",
          };
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
        isLoading={albumsLoading || albums === undefined}
        error={albumsError}
        onRetry={() => useAlbumBrowseSessionStore.getState().bumpRefresh()}
      />
    );
  }

  return (
    <Routes>
      <Route path="/album/:albumId" element={
        <AlbumDetailRoute
          serverWithCred={serverWithCred}
          credError={credError}
          credPending={credPending}
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
          credError={credError}
          credPending={credPending}
          onSelectAlbum={openAlbum}
          onSelectArtist={openArtist}
          onClose={goBack}
          queueClass={queueClass}
        />
      } />
      <Route path="/playlist/:playlistId" element={
        <PlaylistDetailRoute
          serverWithCred={serverWithCred}
          credError={credError}
          credPending={credPending}
          playlists={playlists}
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
              {serverWithCred && (syncStatus === "error" || syncStatus === "partial") && (
                <SyncErrorBanner
                  variant={syncStatus}
                  serverName={serverWithCred.server.display_name}
                  detail={syncError}
                  nextRetryAt={nextRetryAt}
                  onRetry={() => runSync(serverWithCred)}
                />
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
              {serverWithCred && (
                <button
                  className="rescan-btn"
                  onClick={() => runSync(serverWithCred)}
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
              isLoading={artistsLoading || artists === undefined}
              error={artistsError}
              onRetry={() => useArtistBrowseSessionStore.getState().bumpRefresh()}
            />
          ) : (
            <div className="empty-state">
              <p className="empty-state-title">No server connected</p>
              <p className="empty-state-hint">Add your Navidrome server in Settings to browse artists.</p>
            </div>
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
