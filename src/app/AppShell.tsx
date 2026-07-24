import { Suspense, lazy } from "react";
import { Search, X, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { PlayerBar } from "../components/PlayerBar";
import { ScrobbleTracker } from "../hooks/useScrobble";
import { UpdatePrompt } from "../components/UpdatePrompt";
import { RemoteNoticeBanner } from "../components/RemoteNoticeBanner";
import { FeedbackModal } from "../components/FeedbackModal";
import { AppRoutes, type AppViewProps } from "./AppRoutes";

const SearchResults = lazy(() => import("../components/SearchResults").then((m) => ({ default: m.SearchResults })));
const CommandPalette = lazy(() => import("../components/CommandPalette").then((m) => ({ default: m.CommandPalette })));

export function AppShell(props: AppViewProps) {
  const {
    server,
    serverWithCred,
    playlists,
    searchResults,
    searchOpen,
    searchQuery,
    searchRaw,
    searchInputRef,
    handleSearchChange,
    clearSearch,
    view,
    navItems,
    navigateTo,
    openAlbum,
    openArtist,
    openAlbumById,
    handlePlayTrack,
    handleStartRadioFromAlbum,
    handleStartRadioFromArtist,
    addAlbumToPlaylist,
    setCanonicalIdFilters,
    queueClass,
    currentTrack,
    metaBarVisible,
    sidebarExpanded,
    setSidebarExpanded,
    sidebarLiveWidth,
    sidebarWidth,
    handleSidebarResizeMouseDown,
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
  } = props;

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
              playlists={playlists}
              onSelectAlbum={openAlbum}
              onSelectArtist={(artist) => { openArtist({ name: artist.name, album_count: artist.album_count, artwork_url: null, lastfm_image_url: null, wikidata_image_url: null, navidrome_image_url: null, enriched_at: null }); }}
              onPlayTrack={(id) => { void handlePlayTrack(id); }}
              onStartRadioFromAlbum={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
              onStartRadioFromArtist={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
              onAddAlbumToPlaylist={serverWithCred ? (album, pl) => { void addAlbumToPlaylist(pl, album.id, serverWithCred); } : undefined}
            />
          ) : (
            <p className="empty-state">{searchQuery ? "Searching…" : "Start typing to search"}</p>
          )}
        </main>
      );
    }
    return <AppRoutes {...props} />;
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
          {navItems.map(({ id, label, icon, badge }) => (
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
      <ScrobbleTracker track={currentTrack} serverWithCred={serverWithCred ?? undefined} />
      {view !== "nowplaying" && (
        <PlayerBar
          onNowPlaying={() => navigateTo("nowplaying")}
          onSelectArtist={openArtist}
          onSelectAlbumById={async (albumId: string) => { await openAlbumById(albumId); }}
          serverWithCred={serverWithCred ?? undefined}
        />
      )}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(v) => { navigateTo(v); setCommandPaletteOpen(false); }}
        onSelectAlbum={(album) => { openAlbum(album); setCommandPaletteOpen(false); }}
        onSelectArtist={(name, albumCount) => { openArtist({ name, album_count: albumCount, artwork_url: null, lastfm_image_url: null, wikidata_image_url: null, navidrome_image_url: null, enriched_at: null }); setCommandPaletteOpen(false); }}
        onPlayTrack={(id) => { void handlePlayTrack(id); setCommandPaletteOpen(false); }}
        serverWithCredential={serverWithCred ?? undefined}
      />
      {pendingUpdate && (
        <UpdatePrompt
          update={pendingUpdate}
          onDismiss={() => setPendingUpdate(null)}
        />
      )}
      {remoteNotice && (
        <RemoteNoticeBanner
          notice={remoteNotice}
          onDismiss={() => {
            void setLastSeenNoticeId(remoteNotice.id);
            setRemoteNotice(null);
          }}
        />
      )}
      {feedbackOpen && (
        <FeedbackModal
          serverUrl={server?.url}
          onClose={() => { setFeedbackOpen(false); setCrashReport(null); }}
          initialCategory={crashReport ? "bug" : undefined}
          initialText={crashReport ? `Canon crashed last session:\n\n${crashReport}` : undefined}
        />
      )}
    </Suspense>
  );
}
