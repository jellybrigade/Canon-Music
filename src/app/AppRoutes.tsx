import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import type { QueryClient } from "@tanstack/react-query";
import type { Update } from "@tauri-apps/plugin-updater";
import { CredentialNotice } from "../components/CredentialNotice";
import { SearchView } from "../features/search/SearchView";
import { LibraryView } from "../pages/LibraryView";
import { AlbumDetailRoute, ArtistDetailRoute, PlaylistDetailRoute } from "./DetailRoutes";
import type { AlbumRow, AlbumSort, ArtistRow } from "../types/library";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "../hooks/useServer";
import type { PlaylistRow, usePlaylists } from "../features/playlists/usePlaylists";
import type { useLibrarySync } from "../features/sync/useLibrarySync";
import type { useGenres } from "../hooks/useGenres";
import type { useAllTracks } from "../hooks/useAllTracks";
import { useAllTracksSessionStore } from "../store/allTracksSessionStore";
import { useArtistBrowseSessionStore } from "../store/artistBrowseSessionStore";
import type { AppView } from "../hooks/useAppNavigation";
import type { RadioMode, CurrentTrack } from "../features/playback/store/playerTypes";
import type { RemoteNotice } from "../clients/notice";

const ArtistGridLazy = lazy(() => import("../pages/ArtistGrid").then((m) => ({ default: m.ArtistGrid })));
const PlaylistList = lazy(() => import("../features/playlists/PlaylistList").then((m) => ({ default: m.PlaylistList })));
const SettingsView = lazy(() => import("../features/settings/components/SettingsView").then((m) => ({ default: m.SettingsView })));
const TagsView = lazy(() => import("../features/tags/components/TagsView").then((m) => ({ default: m.TagsView })));
const UnidentifiedView = lazy(() => import("../features/enrichment/components/UnidentifiedView").then((m) => ({ default: m.UnidentifiedView })));
const HomeView = lazy(() => import("../pages/HomeView").then((m) => ({ default: m.HomeView })));
const GenreView = lazy(() => import("../pages/GenreView").then((m) => ({ default: m.GenreView })));
const YearsView = lazy(() => import("../pages/YearsView").then((m) => ({ default: m.YearsView })));
const TrackTableView = lazy(() => import("../pages/TrackTableView").then((m) => ({ default: m.TrackTableView })));
const NowPlayingView = lazy(() => import("../features/playback/components/NowPlayingView").then((m) => ({ default: m.NowPlayingView })));

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
  retryCredential: () => void;

  // Search
  searchInputRef: React.RefObject<HTMLInputElement | null>;

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
  leaveSearch: () => void;

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

export function AppRoutes(props: AppViewProps) {
  const {
    server,
    serverWithCred,
    artists,
    artistsLoading,
    artistsError,
    allTracks,
    allTracksLoading,
    allTracksError,
    playlists,
    setCanonicalIdFilters,
    syncStatus,
    syncError,
    runSync,
    credError,
    credPending,
    retryCredential,
    searchInputRef,
    homeSearchRaw,
    homeSearchQuery,
    setHomeSearchRaw,
    navigateTo,
    openAlbum,
    openArtist,
    openPlaylist,
    openAlbumById,
    goBack,
    leaveSearch,
    handlePlayTrack,
    handleStartRadioFromAlbum,
    handleStartRadioFromArtist,
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

  // Every browse route below gates on the same value and so owes the same three states. Built
  // once because eight copies of four props is how the detail routes' copy drifted apart.
  const credentialNotice = (
    <CredentialNotice credError={credError} credPending={credPending} retryCredential={retryCredential} />
  );

  return (
    <Routes>
      <Route path="/album/:albumId" element={
        <AlbumDetailRoute
          serverWithCred={serverWithCred}
          credError={credError}
          credPending={credPending}
          retryCredential={retryCredential}
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
          retryCredential={retryCredential}
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
          retryCredential={retryCredential}
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
          ) : <main className="content-main">{credentialNotice}</main>}
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
              onOpenResync={() => navigateTo("settings")}
              onBack={goBack}
            />
          ) : <main className="content-main">{credentialNotice}</main>}
        </Suspense>
      } />
      <Route path="/library" element={<LibraryView {...props} credentialNotice={credentialNotice} />} />
      <Route path="/search" element={
        <SearchView
          server={server}
          serverWithCred={serverWithCred}
          credError={credError}
          credPending={credPending}
          retryCredential={retryCredential}
          playlists={playlists}
          searchInputRef={searchInputRef}
          queueClass={queueClass}
          leaveSearch={leaveSearch}
          openAlbum={openAlbum}
          openArtist={openArtist}
          handlePlayTrack={handlePlayTrack}
          handleStartRadioFromAlbum={handleStartRadioFromAlbum}
          handleStartRadioFromArtist={handleStartRadioFromArtist}
          addAlbumToPlaylist={addAlbumToPlaylist}
        />
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
          ) : credentialNotice}
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
          ) : <main className="content-main">{credentialNotice}</main>}
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
          ) : credentialNotice}
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
          ) : <main className="content-main">{credentialNotice}</main>}
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
          ) : <main className="content-main">{credentialNotice}</main>}
        </Suspense>
      } />
      <Route path="/settings" element={
        <main className="content-main">
          <SettingsView
            server={server}
            syncStatus={syncStatus}
            runSync={runSync}
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
