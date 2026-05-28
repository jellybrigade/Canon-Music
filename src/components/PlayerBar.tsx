import { useRef } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, List, Volume2, Loader,
} from "lucide-react";
import { usePlayerStore } from "../store/player";
import { RadioChip } from "./RadioChip";
import "./PlayerBar.css";

const SECONDS_PER_MINUTE = 60;

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayerBar() {
  const {
    currentTrack, isPlaying, isLoading, elapsed, volume,
    queue, queueIndex, repeat, isShuffled, isQueueOpen,
    pause, resume, next, prev, setVolume, seek,
    toggleRepeat, toggleShuffle, toggleQueue, toggleNowPlaying,
  } = usePlayerStore();

  const progressBarRef = useRef<HTMLDivElement>(null);

  const duration = currentTrack?.duration ?? 0;
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

  const repeatLabel =
    repeat === "off" ? "Repeat off" : repeat === "repeat-all" ? "Repeat all" : "Repeat one";
  const nextDisabled = repeat === "off" && queueIndex >= queue.length - 1;

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    void seek(ratio * duration);
  }

  if (!currentTrack) return null;

  return (
    <>
      <div className="player-bar">
        <div className="player-section player-section--left">
          <button
            className="player-thumb"
            onClick={toggleNowPlaying}
            aria-label="Now playing"
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
              <Shuffle size={15} />
            </button>
            <button
              className="player-btn"
              onClick={() => void prev()}
              disabled={queue.length === 0}
              aria-label="Previous"
            >
              <SkipBack size={18} />
            </button>
            <button
              className="player-btn player-btn--play"
              onClick={isPlaying ? pause : resume}
              disabled={isLoading}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isLoading
                ? <Loader size={16} className="player-spin" />
                : isPlaying
                  ? <Pause size={16} fill="currentColor" strokeWidth={0} />
                  : <Play size={16} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              className="player-btn"
              onClick={() => void next()}
              disabled={nextDisabled}
              aria-label="Next"
            >
              <SkipForward size={18} />
            </button>
            <button
              className={`player-btn player-btn--icon${repeat !== "off" ? " player-btn--active" : ""}`}
              onClick={() => void toggleRepeat()}
              title={repeatLabel}
              aria-label={repeatLabel}
            >
              {repeat === "repeat-one"
                ? <Repeat1 size={15} />
                : <Repeat size={15} />}
            </button>
          </div>

          <div className="player-progress">
            <span className="player-elapsed">{formatDuration(elapsed)}</span>
            <div
              ref={progressBarRef}
              className="player-progress-bar"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              onClick={handleProgressClick}
              style={{ cursor: duration > 0 ? "pointer" : "default" }}
            >
              <div className="player-progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="player-duration">
              {duration > 0 ? formatDuration(duration) : ""}
            </span>
          </div>
        </div>

        <div className="player-section player-section--right">
          <button
            className={`player-btn player-btn--icon${isQueueOpen ? " player-btn--active" : ""}`}
            onClick={toggleQueue}
            title="Queue"
            aria-label="Queue"
          >
            <List size={16} />
          </button>
          <div className="player-volume">
            <Volume2 size={14} className="player-volume-icon" aria-hidden />
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
      </div>

    </>
  );
}
