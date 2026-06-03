import { useEffect, useRef, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, List, Volume2, Loader, Headphones, Heart, Star, Timer,
} from "lucide-react";
import { usePlayerStore } from "../store/player";
import { useTagsStore } from "../store/tags";
import { useLoved } from "../hooks/useLoved";
import { useSetting } from "../hooks/useSetting";
import { runEnrichment } from "../hooks/useBackgroundNormalizer";
import { PlayerProgress } from "./PlayerProgress";
import { RadioChip } from "./RadioChip";
import { ContextMenu } from "./ContextMenu";
import { getCoverArtUrl, setRating, fetchTrackRating } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import type { ServerWithCredential } from "../hooks/useServer";
import "./PlayerBar.css";

interface Props {
  onNowPlaying: () => void;
  serverWithCred?: ServerWithCredential;
}

export function PlayerBar({ onNowPlaying, serverWithCred }: Props) {
  const currentTrack  = usePlayerStore((s) => s.currentTrack);
  const isPlaying     = usePlayerStore((s) => s.isPlaying);
  const isLoading     = usePlayerStore((s) => s.isLoading);
  const volume        = usePlayerStore((s) => s.volume);
  const queue         = usePlayerStore((s) => s.queue);
  const queueIndex    = usePlayerStore((s) => s.queueIndex);
  const repeat        = usePlayerStore((s) => s.repeat);
  const isShuffled    = usePlayerStore((s) => s.isShuffled);
  const isQueueOpen   = usePlayerStore((s) => s.isQueueOpen);
  const accentColor   = usePlayerStore((s) => s.accentColor);
  const pause         = usePlayerStore((s) => s.pause);
  const resume        = usePlayerStore((s) => s.resume);
  const next          = usePlayerStore((s) => s.next);
  const prev          = usePlayerStore((s) => s.prev);
  const seek          = usePlayerStore((s) => s.seek);
  const setVolume     = usePlayerStore((s) => s.setVolume);
  const toggleRepeat  = usePlayerStore((s) => s.toggleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleQueue   = usePlayerStore((s) => s.toggleQueue);
  const pullProgress        = useTagsStore((s) => s.pullProgress);
  const enrichmentPending   = useTagsStore((s) => s.enrichmentPending);
  const setEnrichmentPending = useTagsStore((s) => s.setEnrichmentPending);
  const [, setSnoozeUntil] = useSetting("enrichment.snooze_until", "");
  const { lovedTrackIds, toggleTrackLove } = useLoved();

  const sleepTimerEndsAt    = usePlayerStore((s) => s.sleepTimerEndsAt);
  const sleepTimerEndOfTrack = usePlayerStore((s) => s.sleepTimerEndOfTrack);
  const setSleepTimer        = usePlayerStore((s) => s.setSleepTimer);
  const clearSleepTimer      = usePlayerStore((s) => s.clearSleepTimer);

  const [snoozeMenu, setSnoozeMenu] = useState<{ x: number; y: number } | null>(null);
  const [artOpen, setArtOpen] = useState(false);
  const artPopoverRef = useRef<HTMLDivElement>(null);
  const artThumbRef = useRef<HTMLButtonElement>(null);

  const [timerOpen, setTimerOpen] = useState(false);
  const [timerPopoverPos, setTimerPopoverPos] = useState<{ right: number; bottom: number } | null>(null);
  const timerBtnRef = useRef<HTMLButtonElement>(null);
  const timerPopoverRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState("");

  const [trackRating, setTrackRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const ratingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHoldFired = useRef(false);

  const handlePrevPointerDown = () => {
    prevHoldFired.current = false;
    prevHoldTimer.current = setTimeout(() => {
      prevHoldFired.current = true;
      void seek(0);
    }, 400);
  };

  const handlePrevPointerUp = () => {
    if (prevHoldTimer.current) {
      clearTimeout(prevHoldTimer.current);
      prevHoldTimer.current = null;
    }
    if (!prevHoldFired.current) {
      void prev();
    }
  };

  const handlePrevPointerLeave = () => {
    if (prevHoldTimer.current) {
      clearTimeout(prevHoldTimer.current);
      prevHoldTimer.current = null;
    }
  };

  const isLoved = currentTrack ? lovedTrackIds.has(currentTrack.id) : false;

  useEffect(() => {
    return () => {
      if (prevHoldTimer.current) clearTimeout(prevHoldTimer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--normalizing-bar-height",
      (pullProgress || enrichmentPending) ? "24px" : "0px"
    );
  }, [pullProgress, enrichmentPending]);

  useEffect(() => {
    if (!artOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArtOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [artOpen]);

  useEffect(() => {
    if (!artOpen) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (artPopoverRef.current?.contains(target)) return;
      if (artThumbRef.current?.contains(target)) return;
      setArtOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [artOpen]);

  // Sleep timer countdown display
  useEffect(() => {
    if (!sleepTimerEndsAt) { setRemaining(""); return; }
    function tick() {
      const ms = sleepTimerEndsAt! - Date.now();
      if (ms <= 0) { setRemaining(""); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, "0")}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepTimerEndsAt]);

  // Close timer popover on outside click
  useEffect(() => {
    if (!timerOpen) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (timerPopoverRef.current?.contains(t) || timerBtnRef.current?.contains(t)) return;
      setTimerOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [timerOpen]);

  // Fetch star rating when track changes
  useEffect(() => {
    if (!currentTrack || !serverWithCred) { setTrackRating(0); return; }
    const { server, credential } = serverWithCred;
    const nativeId = stripServerPrefix(currentTrack.id, server.id);
    void fetchTrackRating(server.url, server.username, credential, nativeId).then(setTrackRating);
  }, [currentTrack?.id, serverWithCred]);

  function handleStarClick(star: number) {
    if (!currentTrack || !serverWithCred) return;
    const newRating = star === trackRating ? 0 : star;
    setTrackRating(newRating);
    if (ratingDebounce.current) clearTimeout(ratingDebounce.current);
    ratingDebounce.current = setTimeout(() => {
      const { server, credential } = serverWithCred;
      const nativeId = stripServerPrefix(currentTrack.id, server.id);
      setRating(server.url, server.username, credential, nativeId, newRating).catch(console.error);
    }, 100);
  }

  const timerActive = sleepTimerEndsAt !== null || sleepTimerEndOfTrack;

  const repeatLabel =
    repeat === "off" ? "Repeat off" : repeat === "repeat-all" ? "Repeat all" : "Repeat one";
  const nextDisabled = repeat === "off" && queueIndex >= queue.length - 1;

  return (
    <>
      {enrichmentPending && !pullProgress && (
        <div className={`normalizing-bar${currentTrack ? " normalizing-bar--above-player" : ""}`}>
          Metadata not fetched for {enrichmentPending} albums
          <button
            className="normalizing-bar__action"
            onClick={() => { void runEnrichment(); }}
          >
            Fetch now
          </button>
          <button
            className="normalizing-bar__dismiss"
            onClick={() => setEnrichmentPending(null)}
          >
            Dismiss
          </button>
          <button
            className="normalizing-bar__more"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSnoozeMenu({ x: r.left, y: r.bottom });
            }}
          >
            …
          </button>
          {snoozeMenu && (
            <ContextMenu x={snoozeMenu.x} y={snoozeMenu.y} onClose={() => setSnoozeMenu(null)}>
              {([
                ["Snooze 1 day", String(Math.floor(Date.now() / 1000) + 86400)],
                ["Snooze 1 week", String(Math.floor(Date.now() / 1000) + 604800)],
                ["Snooze 1 month", String(Math.floor(Date.now() / 1000) + 2592000)],
                ["Never show again", "forever"],
              ] as [string, string][]).map(([label, value]) => (
                <button
                  key={label}
                  onClick={() => {
                    void setSnoozeUntil(value);
                    setEnrichmentPending(null);
                    setSnoozeMenu(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </ContextMenu>
          )}
        </div>
      )}
      {pullProgress && (
        <div className={`normalizing-bar${currentTrack ? " normalizing-bar--above-player" : ""}`}>
          Fetching metadata… {pullProgress.done} / {pullProgress.total}
        </div>
      )}
      {!currentTrack ? null : <div
        className="player-bar"
        style={accentColor ? { '--accent': accentColor, '--accent-hover': accentColor } as React.CSSProperties : undefined}
      >
        <div className="player-section player-section--left">
          <button
            ref={artThumbRef}
            className="player-thumb"
            onClick={() => setArtOpen((v) => !v)}
            aria-label={artOpen ? "Hide album art" : "Show album art"}
          >
            {currentTrack.coverArtUrl && (
              <img src={currentTrack.coverArtUrl} alt="" />
            )}
          </button>
          <div className="player-track-info">
            <span className="player-title">{currentTrack.title}</span>
            {currentTrack.artist && (
              <span className="player-artist">{currentTrack.artist}</span>
            )}
          </div>
          <RadioChip />
        </div>

        <div className="player-section player-section--center">
          <div className="player-controls">
            <button
              className={`player-btn player-btn--icon${isShuffled ? " player-btn--active" : ""}`}
              onClick={toggleShuffle}
              title="Shuffle"
              aria-label="Shuffle"
            >
              <Shuffle size={20} />
            </button>
            <button
              className="player-btn"
              onPointerDown={handlePrevPointerDown}
              onPointerUp={handlePrevPointerUp}
              onPointerLeave={handlePrevPointerLeave}
              disabled={queue.length === 0}
              aria-label="Previous"
            >
              <SkipBack size={24} />
            </button>
            <button
              className="player-btn player-btn--play"
              onClick={isPlaying ? pause : resume}
              disabled={isLoading}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isLoading
                ? <Loader size={22} className="player-spin" />
                : isPlaying
                  ? <Pause size={22} fill="currentColor" strokeWidth={0} />
                  : <Play size={22} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              className="player-btn"
              onClick={() => void next()}
              disabled={nextDisabled}
              aria-label="Next"
            >
              <SkipForward size={24} />
            </button>
            <button
              className={`player-btn player-btn--icon${repeat !== "off" ? " player-btn--active" : ""}`}
              onClick={() => void toggleRepeat()}
              title={repeatLabel}
              aria-label={repeatLabel}
            >
              {repeat === "repeat-one"
                ? <Repeat1 size={20} />
                : <Repeat size={20} />}
            </button>
          </div>

          <div className="player-progress-row">
            <PlayerProgress />
          </div>
        </div>

        <div className="player-section player-section--right">
          {currentTrack && serverWithCred && (
            <>
              <button
                className={`player-btn player-btn--icon${isLoved ? " player-btn--active" : ""}`}
                onClick={() => void toggleTrackLove(currentTrack.id, serverWithCred)}
                title={isLoved ? "Unlove" : "Love"}
                aria-label={isLoved ? "Unlove" : "Love"}
              >
                <Heart size={18} fill={isLoved ? "currentColor" : "none"} strokeWidth={isLoved ? 0 : 2} />
              </button>
              <div
                className="player-stars"
                onMouseLeave={() => setHoverRating(0)}
              >
                {[1, 2, 3, 4, 5].map((star) => {
                  const filled = star <= (hoverRating || trackRating);
                  return (
                    <button
                      key={star}
                      className={`player-star-btn${filled ? " player-star-btn--filled" : ""}`}
                      onClick={() => handleStarClick(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      title={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                      aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                    >
                      <Star size={13} fill={filled ? "currentColor" : "none"} strokeWidth={filled ? 0 : 1.5} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button
            ref={timerBtnRef}
            className={`player-btn player-btn--icon${timerActive ? " player-btn--active" : ""}`}
            onClick={() => {
              if (timerBtnRef.current) {
                const r = timerBtnRef.current.getBoundingClientRect();
                setTimerPopoverPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 });
              }
              setTimerOpen((o) => !o);
            }}
            title={timerActive ? (remaining || "End of track") : "Sleep timer"}
            aria-label="Sleep timer"
          >
            {timerActive && remaining ? (
              <span className="player-timer-remaining">{remaining}</span>
            ) : (
              <Timer size={18} />
            )}
          </button>
          <button
            className="player-btn player-btn--icon"
            onClick={onNowPlaying}
            title="Now playing"
            aria-label="Now playing"
          >
            <Headphones size={22} />
          </button>
          <button
            className={`player-btn player-btn--icon${isQueueOpen ? " player-btn--active" : ""}`}
            onClick={toggleQueue}
            title="Queue"
            aria-label="Queue"
          >
            <List size={22} />
          </button>
          <div
            className="player-volume"
            onWheel={(e) => { e.preventDefault(); void setVolume(Math.max(0, Math.min(1, volume - e.deltaY * 0.001))); }}
          >
            <Volume2 size={18} className="player-volume-icon" aria-hidden />
            <input
              type="range"
              className="player-volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => void setVolume(parseFloat(e.target.value))}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>}

      {timerOpen && (
        <div
          ref={timerPopoverRef}
          className="timer-popover"
          style={timerPopoverPos ? { right: timerPopoverPos.right, bottom: timerPopoverPos.bottom } : undefined}
        >
          {([15, 30, 45, 60] as const).map((min) => (
            <button
              key={min}
              className={`timer-popover-item${sleepTimerEndsAt ? " timer-popover-item--active" : ""}`}
              onClick={() => { setSleepTimer(min); setTimerOpen(false); }}
            >
              {min} min
            </button>
          ))}
          <button
            className={`timer-popover-item${sleepTimerEndOfTrack ? " timer-popover-item--active" : ""}`}
            onClick={() => { setSleepTimer("end-of-track"); setTimerOpen(false); }}
          >
            End of track
          </button>
          {timerActive && (
            <button
              className="timer-popover-item timer-popover-item--off"
              onClick={() => { clearSleepTimer(); setTimerOpen(false); }}
            >
              Off
            </button>
          )}
        </div>
      )}

      {artOpen && currentTrack && (currentTrack.artworkRef || currentTrack.coverArtUrl) && (() => {
        const popoverUrl = serverWithCred && currentTrack.artworkRef
          ? getCoverArtUrl(serverWithCred.server.url, serverWithCred.server.username, serverWithCred.credential, currentTrack.artworkRef, 400)
          : currentTrack.coverArtUrl;
        return popoverUrl ? (
          <div ref={artPopoverRef} className="art-popover" onClick={() => setArtOpen(false)}>
            <img src={popoverUrl} alt={currentTrack.title} />
          </div>
        ) : null;
      })()}
    </>
  );
}
