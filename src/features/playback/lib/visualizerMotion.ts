export interface Bars {
  levels: number[];
  peaks: number[];
  peakAgesMs: number[];
}

const RISE_TIME_CONSTANT_MS = 80;
const FALL_TIME_CONSTANT_MS = 350;
export const PEAK_HOLD_MS = 300;
const PEAK_FALL_PER_SECOND = 0.5;
// A frame after a stall (window hidden, machine busy) would otherwise snap every bar to its target.
const LONGEST_STEP_MS = 50;
const SETTLED_BELOW = 0.002;

export function emptyBars(count: number): Bars {
  const zeros = () => Array.from({ length: count }, () => 0);
  return { levels: zeros(), peaks: zeros(), peakAgesMs: zeros() };
}

/** Moves bars toward `targets` (0..1, one per bar) over `elapsedMs`: fast up, slow down, peaks hold then drift. */
export function stepBars(bars: Bars, targets: readonly number[], elapsedMs: number): Bars {
  const stepMs = Math.min(Math.max(elapsedMs, 0), LONGEST_STEP_MS);
  const rise = 1 - Math.exp(-stepMs / RISE_TIME_CONSTANT_MS);
  const fall = 1 - Math.exp(-stepMs / FALL_TIME_CONSTANT_MS);
  const levels: number[] = [];
  const peaks: number[] = [];
  const peakAgesMs: number[] = [];
  bars.levels.forEach((level, i) => {
    const target = targets[i] ?? 0;
    const next = level + (target - level) * (target > level ? rise : fall);
    const peak = bars.peaks[i] ?? 0;
    const peakAge = (bars.peakAgesMs[i] ?? 0) + stepMs;
    if (next >= peak) {
      peaks.push(next);
      peakAgesMs.push(0);
    } else {
      const drift = peakAge > PEAK_HOLD_MS ? (PEAK_FALL_PER_SECOND * stepMs) / 1000 : 0;
      peaks.push(Math.max(next, peak - drift));
      peakAgesMs.push(peakAge);
    }
    levels.push(next);
  });
  return { levels, peaks, peakAgesMs };
}

export function isSettled(bars: Bars): boolean {
  return bars.peaks.every((peak) => peak < SETTLED_BELOW);
}
