import { Suspense, lazy, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { PlayerBar } from "../components/PlayerBar";
import { ScrobbleTracker } from "../hooks/useScrobble";
import { UpdatePrompt } from "../components/UpdatePrompt";
import { RemoteNoticeBanner } from "../components/RemoteNoticeBanner";
import { FeedbackModal } from "../components/FeedbackModal";
import { AppRoutes, type AppViewProps } from "./AppRoutes";

const CommandPalette = lazy(() => import("../components/CommandPalette").then((m) => ({ default: m.CommandPalette })));

export function AppShell(props: AppViewProps) {
  const {
    server,
    serverWithCred,
    view,
    navItems,
    navigateTo,
    openAlbum,
    openArtist,
    openAlbumById,
    handlePlayTrack,
    setCanonicalIdFilters,
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

  function renderContent() {
    return <AppRoutes {...props} />;
  }

  // The player bar is fixed-position and only rendered when a track is loaded
  // (and never on the now-playing view). Views reserve bottom space through
  // --player-bar-reserve so they don't leave a dead gap when it isn't there.
  const playerBarVisible = Boolean(currentTrack) && view !== "nowplaying";

  return (
    <Suspense fallback={null}>
      <div
        className="app-layout"
        style={{ "--player-bar-reserve": playerBarVisible ? "var(--player-bar-height)" : "0px" } as CSSProperties}
      >
        <nav
          className={`sidebar${sidebarExpanded ? " sidebar--expanded" : ""}${sidebarLiveWidth !== null ? " sidebar--dragging" : ""}`}
          style={{
            width: sidebarExpanded ? `${sidebarLiveWidth ?? sidebarWidth}px` : undefined,
            paddingBottom: `calc(var(--player-bar-reserve) + ${metaBarVisible ? 28 : 4}px)`,
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
        onNavigate={navigateTo}
        onSelectAlbum={openAlbum}
        onSelectArtist={(name, albumCount) => openArtist({ name, album_count: albumCount, artwork_url: null, lastfm_image_url: null, wikidata_image_url: null, navidrome_image_url: null, enriched_at: null })}
        // The only handler here that does not navigate, so the only one still
        // closing the palette itself.
        onPlayTrack={(id) => { void handlePlayTrack(id); setCommandPaletteOpen(false); }}
        serverWithCredential={serverWithCred ?? undefined}
        serverId={server?.id}
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
