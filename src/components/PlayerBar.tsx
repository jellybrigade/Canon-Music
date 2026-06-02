import { useEffect, useRef, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, List, Volume2, Loader, Headphones, Heart,
} from "lucide-react";
import { usePlayerStore } from "../store/player";
import { useTagsStore } from "../store/tags";
import { useLoved } from "../hooks/useLoved";
import { PlayerProgress } from "./PlayerProgress";
import { RadioChip } from "./RadioChip";
import { getCoverArtUrl } from "../lib/navidrome";
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
  const pullProgress  = useTagsStore((s) => s.pullProgress);
  const { lovedTrackIds, toggleTrackLove } = useLoved();

  const [artOpen, setArtOpen] = useState(false);
  const artPopoverRef = useRef<HTMLDivElement>(null);
  const artThumbRef = useRef<HTMLButtonElement>(null);

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
      pullProgress ? "24px" : "0px"
    );
  }, [pullProgress]);

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

  const repeatLabel =
    repeat === "off" ? "Repeat off" : repeat === "repeat-all" ? "Repeat all" : "Repeat one";
  const nextDisabled = repeat === "off" && queueIndex >= queue.length - 1;

  return (
    <>
      {pullProgress && (
        <div className={`normalizing-bar${currentTrack ? " normalizing-bar--above-player" : ""}`}>
          Normalizing tags… {pullProgress.done} / {pullProgress.total}
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

          <PlayerProgress />
        </div>

        <div className="player-section player-section--right">
          {currentTrack && serverWithCred && (
            <button
              className={`player-btn player-btn--icon${isLoved ? " player-btn--active" : ""}`}
              onClick={() => void toggleTrackLove(currentTrack.id, serverWithCred)}
              title={isLoved ? "Unlove" : "Love"}
              aria-label={isLoved ? "Unlove" : "Love"}
            >
              <Heart size={18} fill={isLoved ? "currentColor" : "none"} strokeWidth={isLoved ? 0 : 2} />
            </button>
          )}
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
