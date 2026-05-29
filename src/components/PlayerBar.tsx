import { useEffect, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, List, Volume2, Loader, Headphones,
} from "lucide-react";
import { usePlayerStore } from "../store/player";
import { useTagsStore } from "../store/tags";
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
  const pause         = usePlayerStore((s) => s.pause);
  const resume        = usePlayerStore((s) => s.resume);
  const next          = usePlayerStore((s) => s.next);
  const prev          = usePlayerStore((s) => s.prev);
  const setVolume     = usePlayerStore((s) => s.setVolume);
  const toggleRepeat  = usePlayerStore((s) => s.toggleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleQueue   = usePlayerStore((s) => s.toggleQueue);
  const pullProgress  = useTagsStore((s) => s.pullProgress);

  const [artOpen, setArtOpen] = useState(false);

  useEffect(() => {
    if (!artOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArtOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
      {!currentTrack ? null : <div className="player-bar">
        <div className="player-section player-section--left">
          <button
            className="player-thumb"
            onClick={() => setArtOpen((v) => !v)}
            aria-label="Enlarge album art"
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
              <Shuffle size={17} />
            </button>
            <button
              className="player-btn"
              onClick={() => void prev()}
              disabled={queue.length === 0}
              aria-label="Previous"
            >
              <SkipBack size={20} />
            </button>
            <button
              className="player-btn player-btn--play"
              onClick={isPlaying ? pause : resume}
              disabled={isLoading}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isLoading
                ? <Loader size={18} className="player-spin" />
                : isPlaying
                  ? <Pause size={18} fill="currentColor" strokeWidth={0} />
                  : <Play size={18} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              className="player-btn"
              onClick={() => void next()}
              disabled={nextDisabled}
              aria-label="Next"
            >
              <SkipForward size={20} />
            </button>
            <button
              className={`player-btn player-btn--icon${repeat !== "off" ? " player-btn--active" : ""}`}
              onClick={() => void toggleRepeat()}
              title={repeatLabel}
              aria-label={repeatLabel}
            >
              {repeat === "repeat-one"
                ? <Repeat1 size={17} />
                : <Repeat size={17} />}
            </button>
          </div>

          <PlayerProgress />
        </div>

        <div className="player-section player-section--right">
          <button
            className="player-btn player-btn--icon"
            onClick={onNowPlaying}
            title="Now playing"
            aria-label="Now playing"
          >
            <Headphones size={18} />
          </button>
          <button
            className={`player-btn player-btn--icon${isQueueOpen ? " player-btn--active" : ""}`}
            onClick={toggleQueue}
            title="Queue"
            aria-label="Queue"
          >
            <List size={18} />
          </button>
          <div className="player-volume">
            <Volume2 size={16} className="player-volume-icon" aria-hidden />
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
          <div className="art-popover" onClick={() => setArtOpen(false)}>
            <img src={popoverUrl} alt={currentTrack.title} />
          </div>
        ) : null;
      })()}
    </>
  );
}
