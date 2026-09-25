import { useMemo } from "react";
import { usePlayerStore } from "../store/player";
import { useBoolSetting } from "../../../hooks/useSetting";
import { useSeekBar, formatDuration } from "../hooks/useSeekBar";
import { WaveformBars } from "./WaveformBars";
import { displayedWaveformPeaks } from "../lib/waveformDisplay";

export function PlayerProgress() {
  const duration = usePlayerStore((s) => s.currentTrack?.duration ?? 0);
  const waveformPeaks = usePlayerStore((s) => s.waveformPeaks);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const [showWaveform] = useBoolSetting("player.show_waveform", true);

  const { barRef, elapsed, progress, isJump, sliderProps } = useSeekBar(duration);

  const peaks = displayedWaveformPeaks(showWaveform, waveformPeaks);
  const filledCount = useMemo(
    () => (peaks ? Math.round(progress * peaks.length) : 0),
    [progress, peaks]
  );

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
            filledCount={filledCount}
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
      <span className="player-duration">
        {duration > 0 ? formatDuration(duration) : ""}
      </span>
    </div>
  );
}
