import { useMemo } from "react";
import { usePlayerStore } from "../store/player";
import { useBoolSetting } from "../hooks/useSetting";
import { useSeekBar, formatDuration } from "../hooks/useSeekBar";
import { WaveformBars } from "./WaveformBars";

export function PlayerProgress() {
  const duration = usePlayerStore((s) => s.currentTrack?.duration ?? 0);
  const waveformPeaks = usePlayerStore((s) => s.waveformPeaks);
  const [showWaveform] = useBoolSetting("player.show_waveform", true);

  const { barRef, elapsed, progress, sliderProps } = useSeekBar(duration);

  const useWaveform = showWaveform && waveformPeaks && waveformPeaks.length > 0;
  const filledCount = useMemo(
    () => (waveformPeaks ? Math.round(progress * waveformPeaks.length) : 0),
    [progress, waveformPeaks]
  );

  return (
    <div className="player-progress">
      <span className="player-elapsed">{formatDuration(elapsed)}</span>
      <div
        ref={barRef}
        className={`player-progress-bar${useWaveform ? " player-progress-bar--waveform" : ""}`}
        {...sliderProps}
      >
        {useWaveform ? (
          <WaveformBars
            peaks={waveformPeaks}
            filledCount={filledCount}
            barClass="waveform-bar"
            filledClass="waveform-bar waveform-bar--filled"
          />
        ) : (
          <div className="player-progress-fill" style={{ transform: `scaleX(${progress})` }} />
        )}
      </div>
      <span className="player-duration">
        {duration > 0 ? formatDuration(duration) : ""}
      </span>
    </div>
  );
}
