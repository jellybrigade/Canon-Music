import { useMemo } from "react";
import { WaveformBars } from "./WaveformBars";
import { usePlayerStore } from "../store/player";
import { useSeekBar, formatDuration } from "../hooks/useSeekBar";
import "./NowPlayingProgress.css";

export function NowPlayingProgress({
  duration, overlayPeaks,
}: {
  duration: number;
  overlayPeaks: readonly number[] | null;
}) {
  const { barRef, elapsed, progress, isJump, sliderProps } = useSeekBar(duration);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const overlayFilledCount = useMemo(
    () => (overlayPeaks ? Math.round(progress * overlayPeaks.length) : 0),
    [progress, overlayPeaks]
  );

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
            filledCount={overlayFilledCount}
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
