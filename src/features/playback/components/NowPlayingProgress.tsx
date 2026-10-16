import { formatDuration } from "../../../lib/trackCells";
import { useSeekBar } from "../hooks/useSeekBar";
import { usePlayerStore } from "../store/player";
import { WaveformBars } from "./WaveformBars";
import "./NowPlayingProgress.css";

// Chunkier than the player bar's to suit the taller track, and keeps the bar count low there.
const NOW_PLAYING_WAVEFORM_BAR_PITCH = 6;

export function NowPlayingProgress({
  duration,
  overlayPeaks,
}: {
  duration: number;
  overlayPeaks: readonly number[] | null;
}) {
  const { barRef, elapsed, progress, isJump, sliderProps } = useSeekBar(duration);
  const isBuffering = usePlayerStore((s) => s.isBuffering);

  return (
    <div className="now-playing-progress-row">
      <span className="player-elapsed">{formatDuration(elapsed)}</span>
      <div
        ref={barRef}
        className={`now-playing-progress-bar${overlayPeaks ? " now-playing-progress-bar--waveform" : ""}${isBuffering ? " now-playing-progress-bar--buffering" : ""}`}
        aria-busy={isBuffering || undefined}
        {...sliderProps}
      >
        {overlayPeaks ? (
          <WaveformBars
            peaks={overlayPeaks}
            progress={progress}
            barPitch={NOW_PLAYING_WAVEFORM_BAR_PITCH}
            barClass="now-playing-waveform-bar"
            filledClass="now-playing-waveform-bar now-playing-waveform-bar--filled"
          />
        ) : (
          <div
            className={`now-playing-progress-fill${isJump ? " now-playing-progress-fill--jump" : ""}`}
            style={{ transform: `scaleX(${progress})` }}
          />
        )}
      </div>
      <span className="player-duration">{duration > 0 ? formatDuration(duration) : ""}</span>
    </div>
  );
}
