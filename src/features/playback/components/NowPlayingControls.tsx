import { useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart, Loader, Volume2, VolumeX,
} from "lucide-react";
import { usePlayerStore } from "../store/player";
import { repeatModeLabel } from "../store/playerTypes";
import { RadioButton } from "../../radio/components/RadioButton";
import "./NowPlayingControls.css";

interface Props {
  nextDisabled: boolean;
  isLoved: boolean;
  onToggleLove: () => void;
}

export function NowPlayingControls({ nextDisabled, isLoved, onToggleLove }: Props) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const volume = usePlayerStore((s) => s.volume);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const repeat = usePlayerStore((s) => s.repeat);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleRepeat = usePlayerStore((s) => s.toggleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const repeatLabel = repeatModeLabel(repeat);
  const shuffleLabel = isShuffled ? "Shuffle on" : "Shuffle off";

  return (
    <>
      <div className="now-playing-controls">
        <button
          className={`player-btn player-btn--icon${isShuffled ? " player-btn--active" : ""}`}
          onClick={toggleShuffle}
          title={shuffleLabel}
          aria-label={shuffleLabel}
          aria-pressed={isShuffled}
        >
          <Shuffle size={18} />
        </button>
        <button
          className="player-btn"
          onClick={() => void prev()}
          disabled={queueLength === 0}
          aria-label="Previous"
        >
          <SkipBack size={26} />
        </button>
        <button
          className="player-btn player-btn--play player-btn--play-large"
          onClick={isPlaying ? pause : resume}
          disabled={isLoading}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isLoading
            ? <Loader size={24} className="player-spin" />
            : isPlaying
              ? <Pause size={24} fill="currentColor" strokeWidth={0} />
              : <Play size={24} fill="currentColor" strokeWidth={0} />}
        </button>
        <button
          className="player-btn"
          onClick={() => void next()}
          disabled={nextDisabled}
          aria-label="Next"
        >
          <SkipForward size={26} />
        </button>
        <button
          className={`player-btn player-btn--icon${repeat !== "off" ? " player-btn--active" : ""}`}
          onClick={() => void toggleRepeat()}
          title={repeatLabel}
          aria-label={repeatLabel}
          aria-pressed={repeat !== "off"}
        >
          {repeat === "repeat-one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
        </button>
      </div>

      <div className="now-playing-extras">
        <div className="now-playing-extras-center">
          <RadioButton />
          <button
            className={`player-btn player-btn--icon now-playing-love-btn${isLoved ? " player-btn--active" : ""}`}
            onClick={onToggleLove}
            title={isLoved ? "Unlove" : "Love"}
            aria-label={isLoved ? "Unlove" : "Love"}
          >
            <Heart size={22} fill={isLoved ? "currentColor" : "none"} strokeWidth={isLoved ? 0 : 2} />
          </button>
          <div className="now-playing-volume-wrap">
            {volumeOpen && (
              <div className="now-playing-volume-popover">
                <input
                  type="range"
                  className="player-volume-slider now-playing-volume-slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => void setVolume(parseFloat(e.target.value))}
                  onContextMenu={(e) => { e.preventDefault(); toggleMute(); }}
                  aria-label="Volume"
                />
              </div>
            )}
            <button
              className={`player-btn player-btn--icon${volumeOpen ? " player-btn--active" : ""}`}
              onClick={() => setVolumeOpen((o) => !o)}
              onContextMenu={(e) => { e.preventDefault(); toggleMute(); }}
              title="Volume"
            >
              {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
