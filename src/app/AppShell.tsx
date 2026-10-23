import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { type ComponentProps, type CSSProperties, lazy, Suspense } from "react";
import { FeedbackModal } from "../components/FeedbackModal";
import { RemoteNoticeBanner } from "../components/RemoteNoticeBanner";
import { UpdatePrompt } from "../components/UpdatePrompt";
import { SidebarPins } from "../features/pins/components/SidebarPins";
import { pinTargetOf } from "../features/pins/pins";
import { usePins, useSetPinned } from "../features/pins/usePins";
import { PlayerBar } from "../features/playback/components/PlayerBar";
import { ScrobbleTracker } from "../features/playback/hooks/useScrobble";
import { RadioStartDialogHost } from "../features/radio/components/RadioStartDialog";
import { useRecents, useRecordRecent } from "../features/recents/useRecents";
import { usePaletteActions } from "../hooks/usePaletteActions";
import { usePlayAlbum } from "../hooks/usePlayAlbum";
import { crashReportText } from "../lib/crashReport";
import type { ArtistRow } from "../types/library";
import { AppRoutes, type AppViewProps } from "./AppRoutes";

const CommandPalette = lazy(() => import("../components/CommandPalette").then((m) => ({ default: m.CommandPalette })));

// Its own component so the player state the actions read re-renders only the palette, not every view.
function CommandPaletteWithActions({
  runSync,
  syncStatus,
  ...paletteProps
}: Omit<ComponentProps<typeof CommandPalette>, "actions" | "onPlayAlbum" | "onUnpin"> & {
  runSync: AppViewProps["runSync"];
  syncStatus: AppViewProps["syncStatus"];
}) {
  const actions = usePaletteActions(paletteProps.serverWithCredential, runSync, syncStatus === "syncing");
  const playAlbum = usePlayAlbum(paletteProps.serverWithCredential);
  const setPinned = useSetPinned();
  const { serverId } = paletteProps;
  return (
    <CommandPalette
      {...paletteProps}
      actions={actions}
      onPlayAlbum={(album) => {
        void playAlbum(album);
      }}
      onUnpin={(pin) => {
        if (!serverId) return;
        setPinned(pinTargetOf(pin, serverId), false).catch((err: unknown) =>
          console.error("pins: couldn't remove the pin", err),
        );
      }}
    />
  );
}

const artistRowOf = (name: string, albumCount = 0): ArtistRow => ({
  name,
  album_count: albumCount,
  artwork_url: null,
  lastfm_image_url: null,
  wikidata_image_url: null,
  navidrome_image_url: null,
  enriched_at: null,
});

export function AppShell(props: AppViewProps) {
  const {
    server,
    serverWithCred,
    view,
    navItems,
    navigateTo,
    openAlbum,
    openAlbumAtTrack,
    openArtist,
    openAlbumById,
    searchFor,
    handleStartRadioFromArtist,
    handlePlayTrack,
    setCanonicalIdFilters,
    currentTrack,
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
    dismissRemoteNotice,
    runSync,
    syncStatus,
  } = props;

  const { data: pins } = usePins(server?.id);
  const { data: recents } = useRecents(server?.id);
  const recordRecent = useRecordRecent();

  function renderContent() {
    return <AppRoutes {...props} />;
  }

  // The player bar is fixed-position and only rendered when a track is loaded
  // (and never on the now-playing view). Views reserve bottom space through
  // --player-bar-reserve so they don't leave a dead gap when it isn't there.
  const playerBarVisible = Boolean(currentTrack) && view !== "nowplaying";
  const hasSidebarFooter = view !== "nowplaying";

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
          }}
        >
          <div
            className={`sidebar-items${hasSidebarFooter ? "" : " sidebar-items--no-footer"}`}
            style={{ "--sidebar-nav-count": navItems.length } as CSSProperties}
          >
            {navItems.map(({ id, label, icon, badge }) => (
              <button
                key={id}
                className={`sidebar-btn${view === id ? " sidebar-btn--active" : ""}`}
                title={badge ? `${label} (${badge} unmapped)` : label}
                onClick={() => {
                  setCanonicalIdFilters([]);
                  navigateTo(id);
                }}
              >
                <span className="sidebar-btn-icon">
                  {icon}
                  {badge ? <span className="sidebar-badge">{badge > 99 ? "99+" : badge}</span> : null}
                </span>
                {sidebarExpanded && <span className="sidebar-btn-label">{label}</span>}
              </button>
            ))}
            <SidebarPins
              serverWithCredential={serverWithCred ?? undefined}
              isExpanded={sidebarExpanded}
              onSelectAlbum={openAlbum}
              onSelectArtist={(artist) => openArtist({ ...artist, artwork_url: null, enriched_at: null })}
            />
            {hasSidebarFooter && (
              <>
                <button className="sidebar-feedback-btn" title="Send feedback" onClick={() => setFeedbackOpen(true)}>
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
          </div>
          {sidebarExpanded && <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeMouseDown} />}
        </nav>
        {renderContent()}
      </div>
      <ScrobbleTracker track={currentTrack} serverWithCred={serverWithCred ?? undefined} />
      {view !== "nowplaying" && (
        <PlayerBar
          onNowPlaying={() => navigateTo("nowplaying")}
          onOpenResync={() => navigateTo("settings")}
          onSelectArtist={openArtist}
          onSelectAlbumById={async (albumId: string) => {
            await openAlbumById(albumId);
          }}
          serverWithCred={serverWithCred ?? undefined}
        />
      )}
      <CommandPaletteWithActions
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={navigateTo}
        onSelectAlbum={openAlbum}
        onSelectArtist={(name, albumCount) => openArtist(artistRowOf(name, albumCount))}
        onOpenTrack={openAlbumAtTrack}
        onSearchAll={searchFor}
        onOpened={(target) => {
          void recordRecent(target).catch((err: unknown) => console.error("Ctrl+K recents:", err));
        }}
        onStartArtistRadio={(name) => {
          void handleStartRadioFromArtist(artistRowOf(name), "curated");
        }}
        onPlayTrack={(id) => {
          void handlePlayTrack(id);
        }}
        serverWithCredential={serverWithCred ?? undefined}
        serverId={server?.id}
        pins={pins}
        recents={recents}
        runSync={runSync}
        syncStatus={syncStatus}
      />
      {pendingUpdate && <UpdatePrompt update={pendingUpdate} onDismiss={() => setPendingUpdate(null)} />}
      {remoteNotice && <RemoteNoticeBanner notice={remoteNotice} onDismiss={() => void dismissRemoteNotice()} />}
      {feedbackOpen && (
        <FeedbackModal
          serverUrl={server?.url}
          onClose={() => {
            setFeedbackOpen(false);
            setCrashReport(null);
          }}
          initialCategory={crashReport ? "bug" : undefined}
          initialText={crashReport ? crashReportText(crashReport) : undefined}
        />
      )}
      <RadioStartDialogHost />
    </Suspense>
  );
}
