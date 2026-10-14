import { Volume2, VolumeX } from "lucide-react";
import { usePlayerStore } from "../store/player";
import { useVolumeWheel } from "../hooks/useVolumeWheel";

interface Props {
  className: string;
  iconSize: number;
  /** Adds the "Volume" label and the percentage readout, for the narrow-window menu. */
  isLabelled?: boolean;
}

export function VolumeControl({ className, iconSize, isLabelled = false }: Props) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const volumeWheelRef = useVolumeWheel();
  const muteLabel = volume > 0 ? "Mute" : "Unmute";

  return (
    <div className={className} ref={volumeWheelRef}>
      <button
        type="button"
        className="player-btn player-btn--icon player-volume-mute-btn"
        onClick={toggleMute}
        title={muteLabel}
        aria-label={muteLabel}
      >
        {volume > 0
          ? <Volume2 size={iconSize} className="player-volume-icon" />
          : <VolumeX size={iconSize} className="player-volume-icon" />}
      </button>
      {isLabelled && <span className="player-more-row__label player-more-volume__label">Volume</span>}
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
      {isLabelled && <span className="player-more-volume__value">{Math.round(volume * 100)}%</span>}
    </div>
  );
}
