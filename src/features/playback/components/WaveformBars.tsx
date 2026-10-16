import type React from "react";
import { memo, useMemo } from "react";
import { useMeasuredElement } from "../../../hooks/useMeasuredElement";
import { fitWaveformPeaks } from "../lib/waveformDisplay";
import "./WaveformBars.css";

interface Props {
  peaks: readonly number[];
  /** Played share of the track, 0..1. */
  progress: number;
  /** Width in px each bar takes including its gap; sets how many bars fit. */
  barPitch: number;
  barClass: string;
  filledClass: string;
}

export function WaveformBars({ peaks, progress, barPitch, barClass, filledClass }: Props) {
  const { attach, width } = useMeasuredElement<HTMLDivElement>();
  const fittedPeaks = useMemo(() => fitWaveformPeaks(peaks, width, barPitch), [peaks, width, barPitch]);
  const filledCount = Math.round(progress * fittedPeaks.length);

  return (
    <div ref={attach} className="waveform-bars">
      <WaveformBarRun peaks={fittedPeaks} filledCount={filledCount} barClass={barClass} filledClass={filledClass} />
    </div>
  );
}

// Memoised apart from the measuring wrapper so a position tick re-renders the bars only when
// the fill boundary crosses one.
const WaveformBarRun = memo(function WaveformBarRun({
  peaks,
  filledCount,
  barClass,
  filledClass,
}: {
  peaks: readonly number[];
  filledCount: number;
  barClass: string;
  filledClass: string;
}) {
  return (
    <>
      {peaks.map((peak, i) => (
        <div
          key={i}
          className={i < filledCount ? filledClass : barClass}
          style={{ "--peak": peak, "--bar-phase": i / peaks.length } as React.CSSProperties}
        />
      ))}
    </>
  );
});
