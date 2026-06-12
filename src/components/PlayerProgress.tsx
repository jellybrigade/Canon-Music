import React, { useMemo, useRef } from "react";
import { usePlayerStore } from "../store/player";
import { useBoolSetting } from "../hooks/useSetting";
import { WaveformBars } from "./WaveformBars";

const SECONDS_PER_MINUTE = 60;

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayerProgress() {
  const elapsed = usePlayerStore((s) => s.elapsed);
  const duration = usePlayerStore((s) => s.currentTrack?.duration ?? 0);
  const seek = usePlayerStore((s) => s.seek);
  const waveformPeaks = usePlayerStore((s) => s.waveformPeaks);
  const [showWaveform] = useBoolSetting("player.show_waveform", false);

  const progressBarRef = useRef<HTMLDivElement>(null);
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    void seek(ratio * duration);
  }

  function handleProgressKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (duration <= 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      void seek(Math.min(duration, elapsed + duration * 0.05));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      void seek(Math.max(0, elapsed - duration * 0.05));
    }
  }

  const useWaveform = showWaveform && waveformPeaks && waveformPeaks.length > 0;
  const filledCount = useMemo(
    () => (waveformPeaks ? Math.round(progress * waveformPeaks.length) : 0),
    [progress, waveformPeaks]
  );

  return (
    <div className="player-progress">
      <span className="player-elapsed">{formatDuration(elapsed)}</span>
      <div
        ref={progressBarRef}
        className={`player-progress-bar${useWaveform ? " player-progress-bar--waveform" : ""}`}
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={duration > 0 ? 0 : -1}
        onClick={handleProgressClick}
        onKeyDown={handleProgressKeyDown}
        style={{ cursor: duration > 0 ? "pointer" : "default" }}
      >
        {useWaveform ? (
          <WaveformBars
            peaks={waveformPeaks}
            filledCount={filledCount}
            barClass="waveform-bar"
            filledClass="waveform-bar waveform-bar--filled"
          />
        ) : (
          <div className="player-progress-fill" style={{ width: `${progress * 100}%` }} />
        )}
      </div>
      <span className="player-duration">
        {duration > 0 ? formatDuration(duration) : ""}
      </span>
    </div>
  );
}
