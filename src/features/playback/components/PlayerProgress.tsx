import { useBoolSetting } from "../../../hooks/useSetting";
import { formatDuration } from "../../../lib/trackCells";
import { useSeekBar } from "../hooks/useSeekBar";
import { displayedWaveformPeaks } from "../lib/waveformDisplay";
import { usePlayerStore } from "../store/player";
import { WaveformBars } from "./WaveformBars";

// 3px bars with the 1px gap: dense enough to read as a waveform, wide enough to stay crisp.
const PLAYER_WAVEFORM_BAR_PITCH = 4;

export function PlayerProgress() {
  const duration = usePlayerStore((s) => s.currentTrack?.duration ?? 0);
  const waveformPeaks = usePlayerStore((s) => s.waveformPeaks);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const [showWaveform] = useBoolSetting("player.show_waveform", true);

  const { barRef, elapsed, progress, isJump, sliderProps } = useSeekBar(duration);

  const peaks = displayedWaveformPeaks(showWaveform, waveformPeaks);

  return (
    <div className="player-progress">
      <span className="player-elapsed">{formatDuration(elapsed)}</span>
      <div
        ref={barRef}
        className={`player-progress-bar${peaks ? " player-progress-bar--waveform" : ""}${isBuffering ? " player-progress-bar--buffering" : ""}`}
        aria-busy={isBuffering || undefined}
        {...sliderProps}
      >
        {peaks ? (
          <WaveformBars
            peaks={peaks}
            progress={progress}
            barPitch={PLAYER_WAVEFORM_BAR_PITCH}
            barClass="waveform-bar"
            filledClass="waveform-bar waveform-bar--filled"
          />
        ) : (
          <div
            className={`player-progress-fill${isJump ? " player-progress-fill--jump" : ""}`}
            style={{ transform: `scaleX(${progress})` }}
          />
        )}
      </div>
      <span className="player-duration">{duration > 0 ? formatDuration(duration) : ""}</span>
    </div>
  );
}
