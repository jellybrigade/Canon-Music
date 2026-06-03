import React, { memo } from "react";

interface Props {
  peaks: number[];
  filledCount: number;
  barClass: string;
  filledClass: string;
}

export const WaveformBars = memo(function WaveformBars({ peaks, filledCount, barClass, filledClass }: Props) {
  return (
    <>
      {peaks.map((peak, i) => (
        <div
          key={i}
          className={i < filledCount ? filledClass : barClass}
          style={{ "--peak": peak } as React.CSSProperties}
        />
      ))}
    </>
  );
});
