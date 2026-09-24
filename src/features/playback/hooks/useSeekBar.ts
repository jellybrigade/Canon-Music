import React, { useCallback, useRef } from "react";
import { usePlayerStore } from "../store/player";

const SECONDS_PER_MINUTE = 60;

/** Shared m:ss formatter for the transport row. */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Fraction of the track a single arrow-key press moves. */
const KEY_STEP_RATIO = 0.05;

export interface SeekBarState {
  /** Attach to the element carrying the track background. */
  barRef: React.RefObject<HTMLDivElement | null>;
  /** Current position in seconds, subscribed narrowly so only the bar re-renders on tick. */
  elapsed: number;
  /** Position as 0..1, clamped. 0 when the duration is unknown. */
  progress: number;
  /** Spread onto the slider element. Covers role, a11y, keyboard and click-to-seek. */
  sliderProps: {
    role: "slider";
    "aria-label": string;
    "aria-valuemin": number;
    "aria-valuemax": number;
    "aria-valuenow": number;
    "aria-valuetext": string;
    "aria-disabled"?: true;
    tabIndex: number;
    onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  };
}

/**
 * Seek-bar behaviour shared by the player bar and the now-playing overlay.
 *
 * Both previously carried byte-identical click and keyboard handlers, and the overlay kept its
 * click handler up in the view component while its sibling keyboard handler sat in the child.
 * Centralizing them also means the ARIA contract is written once: values are reported in seconds
 * with a spoken `aria-valuetext`, rather than the bare 0-100 percentage that screen readers used
 * to announce as a meaningless number.
 */
export function useSeekBar(duration: number): SeekBarState {
  const elapsed = usePlayerStore((s) => s.elapsed);
  const seek = usePlayerStore((s) => s.seek);
  const barRef = useRef<HTMLDivElement>(null);

  const seekable = duration > 0;
  const progress = seekable ? Math.min(elapsed / duration, 1) : 0;

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!barRef.current || duration <= 0) return;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      void seek(ratio * duration);
    },
    [duration, seek]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      const step = duration * KEY_STEP_RATIO;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        void seek(Math.min(duration, elapsed + step));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        void seek(Math.max(0, elapsed - step));
      } else if (e.key === "Home") {
        e.preventDefault();
        void seek(0);
      } else if (e.key === "End") {
        e.preventDefault();
        void seek(duration);
      }
    },
    [duration, elapsed, seek]
  );

  return {
    barRef,
    elapsed,
    progress,
    sliderProps: {
      role: "slider",
      "aria-label": "Seek",
      "aria-valuemin": 0,
      "aria-valuemax": Math.round(duration),
      "aria-valuenow": Math.round(elapsed),
      "aria-valuetext": seekable
        ? `${formatDuration(elapsed)} of ${formatDuration(duration)}`
        : "No track playing",
      ...(seekable ? {} : { "aria-disabled": true as const }),
      tabIndex: seekable ? 0 : -1,
      onClick,
      onKeyDown,
    },
  };
}
