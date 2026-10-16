import { AlertCircle, ChevronLeft, ListX, RefreshCw, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type BandsintownEvent, fetchBandsintownEvents } from "../../../clients/bandsintown";
import { parseLrc } from "../../../clients/lrclib";
import { getCoverArtUrl } from "../../../clients/navidromeUrls";
import { AlbumArt } from "../../../components/AlbumArt";
import { ArtBackdrop } from "../../../components/ArtBackdrop";
import { useAlbumDisplayName } from "../../../hooks/useAlbumDisplayName";
import { useLoved } from "../../../hooks/useLoved";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { useBoolSetting } from "../../../hooks/useSetting";
import { isTextEntryTarget } from "../../../lib/keyboard";
import type { AlbumRow } from "../../../types/library";
import { useAnyModalOpen } from "../../../ui/useModalChrome";
import { type LyricsOverride, useLyrics } from "../hooks/useLyrics";
import { useNowPlayingAlbums, useNowPlayingTopTracks, useSuggestedTracks } from "../hooks/useNowPlayingArtist";
import { primaryArtistOf } from "../lib/nowPlayingQueries";
import { albumRowOfTrack } from "../lib/trackAlbum";
import { displayedWaveformPeaks } from "../lib/waveformDisplay";
import { usePlayerStore } from "../store/player";
import { isNextDisabled, type RadioMode } from "../store/playerTypes";
import { LyricsTabPanel } from "./LyricsTabPanel";
import { NowPlayingAbout } from "./NowPlayingAbout";
import { NowPlayingControls } from "./NowPlayingControls";
import { NowPlayingProgress } from "./NowPlayingProgress";
import { PlaybackErrorActions } from "./PlaybackErrorActions";
import { UpNextList } from "./UpNextList";
import "./NowPlayingView.css";

type Tab = "up-next" | "about" | "lyrics";

const TABS: readonly Tab[] = ["up-next", "about", "lyrics"];
const TAB_LABELS: Record<Tab, string> = { "up-next": "Up Next", about: "About", lyrics: "Lyrics" };

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  onOpenResync: () => void;
  onBack?: () => void;
}
export function NowPlayingView({
  serverWithCredential,
  onSelectAlbum,
  onSelectArtist,
  onStartRadio,
  onOpenResync,
  onBack,
}: Props) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const repeat = usePlayerStore((s) => s.repeat);
  const radioOnQueueEnd = usePlayerStore((s) => s.radioOnQueueEnd);
  const next = usePlayerStore((s) => s.next);
  const error = usePlayerStore((s) => s.error);
  const retryCurrent = usePlayerStore((s) => s.retryCurrent);
  const seek = usePlayerStore((s) => s.seek);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const audioFormat = usePlayerStore((s) => s.audioFormat);
  const { lovedTrackIds, toggleTrackLove } = useLoved();
  const albumDisplayName = useAlbumDisplayName();
  const upNextRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("up-next");
  // Only the narrow layout reads this: there the tab panel replaces the hero instead of sitting
  // under it, so neither state needs a scrollbar.
  const [isExpanded, setIsExpanded] = useState(false);
  const isAnyModalOpen = useAnyModalOpen();
  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false);
  const [lyricsSearchArtist, setLyricsSearchArtist] = useState("");
  const [lyricsSearchTitle, setLyricsSearchTitle] = useState("");
  const [lyricsOverride, setLyricsOverride] = useState<LyricsOverride | null>(null);

  const { server, credential } = serverWithCredential;
  const duration = currentTrack?.duration ?? 0;
  const nextDisabled = isNextDisabled(repeat, queueIndex, queue.length, radioOnQueueEnd);
  const isLoved = currentTrack ? lovedTrackIds.has(currentTrack.id) : false;
  const currentAlbum = currentTrack ? albumRowOfTrack(currentTrack) : null;

  const primaryArtist = primaryArtistOf(currentTrack?.artist);
  const { data: artistAlbums, isPending: albumsPending } = useNowPlayingAlbums(primaryArtist, server.id);
  const { data: topTracks, isPending: topTracksPending } = useNowPlayingTopTracks(primaryArtist, server.id);
  const { data: suggestedTracks } = useSuggestedTracks(primaryArtist, currentTrack?.id ?? null, server.id);
  // Both start out `undefined`, which is indistinguishable from "the artist has nothing" unless
  // the pending flags are consulted. Without them the About tab asserted "No artist info
  // available." for the whole of the Last.fm round trip, then replaced it with the content.
  const aboutPending = !!primaryArtist && (albumsPending || topTracksPending);
  const {
    plain: lyricsPlain,
    synced: lyricsSynced,
    loading: lyricsLoading,
    refresh: lyricsRefresh,
    offsetMs: lyricsOffsetMs,
    setOffsetMs: setLyricsOffsetMs,
  } = useLyrics(currentTrack ?? null, lyricsOverride, serverWithCredential);
  const lyricsLines = useMemo(() => (lyricsSynced ? parseLrc(lyricsSynced) : null), [lyricsSynced]);
  const accent = usePlayerStore((s) => s.accentColor);
  const waveformPeaks = usePlayerStore((s) => s.waveformPeaks);
  const [showWaveform] = useBoolSetting("player.show_waveform", true);
  const [bandsintownEnabled, setBandsintownEnabled] = useBoolSetting("enrichment.bandsintown_enabled", false);
  const [tourEvents, setTourEvents] = useState<BandsintownEvent[]>([]);
  const [tourLoading, setTourLoading] = useState(false);
  useEffect(() => {
    if (!bandsintownEnabled || !primaryArtist) {
      setTourEvents([]);
      setTourLoading(false);
      return;
    }
    let cancelled = false;
    setTourLoading(true);
    fetchBandsintownEvents(primaryArtist)
      .then((events) => {
        if (!cancelled) {
          setTourEvents(events);
          setTourLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setTourLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bandsintownEnabled, primaryArtist]);

  const overlayPeaks = displayedWaveformPeaks(showWaveform, waveformPeaks);

  const largeArtUrl = currentTrack?.artworkRef
    ? getCoverArtUrl(server.url, server.username, credential, currentTrack.artworkRef, 600)
    : (currentTrack?.coverArtUrl ?? null);
  // Blur destroys detail anyway, so the full-viewport blurred backdrop only needs a
  // tiny source image (avoids WebKit running its expensive blur filter over 600px
  // of pixels it's about to throw away).
  const blurArtUrl = currentTrack?.artworkRef
    ? getCoverArtUrl(server.url, server.username, credential, currentTrack.artworkRef, 64)
    : (currentTrack?.coverArtUrl ?? null);

  const otherAlbums = useMemo(
    () => artistAlbums?.filter((a) => a.id !== currentTrack?.albumId) ?? [],
    [artistAlbums, currentTrack?.albumId],
  );

  useEffect(() => {
    setLyricsOverride(null);
    setLyricsSearchOpen(false);
    setLyricsSearchArtist(currentTrack?.artist ?? "");
    setLyricsSearchTitle(currentTrack?.title ?? "");
  }, [currentTrack?.id]);

  // Also keyed on queueIndex: with the tab left open, a track advance moved the highlight but
  // not the scroll position, so the playing row walked off the bottom of a long queue.
  useEffect(() => {
    if (tab !== "up-next" || !upNextRef.current) return;
    const active = upNextRef.current.querySelector(".now-playing-up-next-row--active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [tab, queueIndex]);

  useEffect(() => {
    if (!isExpanded || isAnyModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTextEntryTarget(e)) setIsExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded, isAnyModalOpen]);

  const expandTo = (t: Tab) => {
    setTab(t);
    setIsExpanded(true);
  };

  if (!currentTrack) {
    return (
      <div className="now-playing-view now-playing-view--empty">
        <p className="now-playing-empty">Nothing playing.</p>
      </div>
    );
  }

  return (
    <div
      className={`now-playing-view${isExpanded ? " now-playing-view--expanded" : ""}`}
      style={
        {
          ...(accent ? { "--np-dominant": accent } : {}),
        } as React.CSSProperties
      }
    >
      <ArtBackdrop imageUrl={blurArtUrl} className="now-playing-backdrop" />
      {onBack && (
        <button className="now-playing-back-btn player-btn player-btn--icon" onClick={onBack} title="Back">
          <ChevronLeft size={22} />
        </button>
      )}
      <div className="now-playing-main">
        <div className="now-playing-mini-bar">
          <button className="now-playing-mini" onClick={() => setIsExpanded(false)} title="Show full player">
            {largeArtUrl ? (
              <AlbumArt
                src={largeArtUrl}
                artist={currentTrack.artist}
                album={currentTrack.album ?? null}
                alt=""
                className="now-playing-mini-art"
              />
            ) : (
              <div className="now-playing-mini-art now-playing-art--placeholder" />
            )}
            <span className="now-playing-mini-title">{currentTrack.title}</span>
          </button>
          <button
            className="now-playing-collapse-btn player-btn player-btn--icon"
            onClick={() => setIsExpanded(false)}
            title="Close"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Left: art + chrome ── */}
        <div className="now-playing-left">
          <div className="now-playing-art-frame">
            {largeArtUrl ? (
              <AlbumArt
                src={largeArtUrl}
                artist={currentTrack.artist}
                album={currentTrack.album ?? null}
                alt={currentTrack.title}
                className="now-playing-art"
              />
            ) : (
              <div className="now-playing-art now-playing-art--placeholder" />
            )}
          </div>

          <div className="now-playing-hero-body">
            <div className="now-playing-info">
              <div className="now-playing-title-row">
                <p className="now-playing-title" title={currentTrack.title}>
                  {currentTrack.title}
                </p>
              </div>
              {currentTrack.artist &&
                (onSelectArtist ? (
                  <button
                    className="now-playing-artist now-playing-artist--link"
                    onClick={() => onSelectArtist(currentTrack.artist!)}
                  >
                    {currentTrack.artist}
                  </button>
                ) : (
                  <p className="now-playing-artist">{currentTrack.artist}</p>
                ))}
              {currentTrack.album &&
                (currentAlbum ? (
                  <button
                    className="now-playing-album now-playing-album--link"
                    onClick={() => onSelectAlbum(currentAlbum)}
                  >
                    {albumDisplayName(currentTrack.album!)}
                  </button>
                ) : (
                  <p className="now-playing-album">{albumDisplayName(currentTrack.album!)}</p>
                ))}
            </div>

            <NowPlayingProgress duration={duration} overlayPeaks={overlayPeaks} />

            {error && (
              <div className="now-playing-error" role="alert">
                <AlertCircle size={15} className="now-playing-error-icon" aria-hidden="true" />
                <span className="now-playing-error-msg">{error.message}</span>
                <PlaybackErrorActions
                  cause={error.cause}
                  onRetry={retryCurrent}
                  onSkip={() => void next()}
                  skipDisabled={nextDisabled}
                  onOpenResync={onOpenResync}
                />
              </div>
            )}

            {audioFormat && (
              <div className="now-playing-format">
                {audioFormat.codec && `${audioFormat.codec} · `}
                {audioFormat.sampleRate >= 1000
                  ? `${(audioFormat.sampleRate / 1000).toFixed(1)} kHz`
                  : `${audioFormat.sampleRate} Hz`}
                {" · "}
                {audioFormat.channels === 1
                  ? "mono"
                  : audioFormat.channels === 2
                    ? "stereo"
                    : `${audioFormat.channels}ch`}
              </div>
            )}

            <NowPlayingControls
              nextDisabled={nextDisabled}
              isLoved={isLoved}
              onToggleLove={() => void toggleTrackLove(currentTrack.id, serverWithCredential)}
            />
          </div>
        </div>

        <div className="now-playing-launcher">
          {TABS.map((t) => (
            <button key={t} className="now-playing-launcher-btn" onClick={() => expandTo(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ── Right: tabbed panel ── */}
        <div className="now-playing-right">
          <div className="now-playing-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`now-playing-tab-btn${tab === t ? " now-playing-tab-btn--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
            {tab === "up-next" && queue.length > 0 && (
              <button
                className="now-playing-tab-refresh-btn"
                title="Clear queue"
                aria-label="Clear queue"
                onClick={() => clearQueue()}
              >
                <ListX size={14} />
              </button>
            )}
            {tab === "lyrics" && (
              <div className="now-playing-tab-lyric-actions">
                {lyricsLines && (
                  <div className="lyrics-offset-controls">
                    <button
                      className="now-playing-tab-refresh-btn"
                      title="Shift lyrics earlier (−500ms)"
                      style={{ margin: 0 }}
                      onClick={() => void setLyricsOffsetMs(lyricsOffsetMs - 500)}
                    >
                      −
                    </button>
                    {lyricsOffsetMs !== 0 && (
                      <button
                        className="lyrics-offset-value"
                        title="Reset offset"
                        onClick={() => void setLyricsOffsetMs(0)}
                      >
                        {lyricsOffsetMs > 0 ? "+" : ""}
                        {(lyricsOffsetMs / 1000).toFixed(1)}s
                      </button>
                    )}
                    <button
                      className="now-playing-tab-refresh-btn"
                      title="Shift lyrics later (+500ms)"
                      style={{ margin: 0 }}
                      onClick={() => void setLyricsOffsetMs(lyricsOffsetMs + 500)}
                    >
                      +
                    </button>
                  </div>
                )}
                <button
                  className={`now-playing-tab-refresh-btn${lyricsSearchOpen ? " now-playing-tab-refresh-btn--active" : ""}`}
                  title="Search manually"
                  style={{ margin: 0 }}
                  onClick={() => setLyricsSearchOpen((o) => !o)}
                >
                  <span style={{ fontSize: 11 }}>A→Z</span>
                </button>
                <button
                  className="now-playing-tab-refresh-btn"
                  title="Re-fetch lyrics"
                  disabled={lyricsLoading}
                  style={{ margin: 0 }}
                  onClick={() => {
                    setLyricsOverride(null);
                    void lyricsRefresh();
                  }}
                >
                  <RefreshCw size={13} className={lyricsLoading ? "spin" : ""} />
                </button>
              </div>
            )}
          </div>

          <div className="now-playing-tab-panel" ref={tab === "up-next" ? upNextRef : undefined}>
            {tab === "up-next" && (
              <UpNextList
                serverWithCredential={serverWithCredential}
                lovedTrackIds={lovedTrackIds}
                onSelectAlbum={onSelectAlbum}
                onSelectArtist={onSelectArtist}
              />
            )}

            {tab === "about" && (
              <NowPlayingAbout
                serverWithCredential={serverWithCredential}
                primaryArtist={primaryArtist}
                pending={aboutPending}
                otherAlbums={otherAlbums}
                topTracks={topTracks}
                suggestedTracks={suggestedTracks}
                tour={{
                  enabled: bandsintownEnabled,
                  loading: tourLoading,
                  events: tourEvents,
                  onEnable: () => void setBandsintownEnabled(true),
                }}
                onSelectAlbum={onSelectAlbum}
                onSelectArtist={onSelectArtist}
                onStartRadio={onStartRadio}
              />
            )}

            {tab === "lyrics" && (
              <LyricsTabPanel
                key={currentTrack?.id}
                lyricsLines={lyricsLines}
                lyricsPlain={lyricsPlain}
                lyricsLoading={lyricsLoading}
                lyricsOffsetMs={lyricsOffsetMs}
                lyricsSearchOpen={lyricsSearchOpen}
                lyricsSearchArtist={lyricsSearchArtist}
                lyricsSearchTitle={lyricsSearchTitle}
                setLyricsSearchArtist={setLyricsSearchArtist}
                setLyricsSearchTitle={setLyricsSearchTitle}
                lyricsOverride={lyricsOverride}
                setLyricsOverride={setLyricsOverride}
                currentTrackArtist={currentTrack?.artist ?? null}
                currentTrackTitle={currentTrack?.title ?? null}
                onSeek={(t) => void seek(t)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
