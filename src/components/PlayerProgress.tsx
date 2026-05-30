import { useRef } from "react";
import { usePlayerStore } from "../store/player";
import { useSetting } from "../hooks/useSetting";

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
  const [showWaveform] = useSetting("player.show_waveform", "false");

  const progressBarRef = useRef<HTMLDivElement>(null);
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    void seek(ratio * duration);
  }

  const useWaveform = showWaveform === "true" && waveformPeaks && waveformPeaks.length > 0;

  return (
    <div className="player-progress">
      <span className="player-elapsed">{formatDuration(elapsed)}</span>
      <div
        ref={progressBarRef}
        className={`player-progress-bar${useWaveform ? " player-progress-bar--waveform" : ""}`}
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        onClick={handleProgressClick}
        style={{ cursor: duration > 0 ? "pointer" : "default" }}
      >
        {useWaveform ? (
          waveformPeaks.map((peak, i) => (
            <div
              key={i}
              className={`waveform-bar${i / waveformPeaks.length < progress ? " waveform-bar--filled" : ""}`}
              style={{ "--peak": peak } as React.CSSProperties}
            />
          ))
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
