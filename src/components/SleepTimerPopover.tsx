import type { RefObject } from "react";
import { usePlayerStore } from "../store/player";

const PRESET_MINUTES = [15, 30, 45, 60] as const;

interface Props {
  popoverRef: RefObject<HTMLDivElement | null>;
  position: { right: number; bottom: number } | null;
  onClose: () => void;
}

export function SleepTimerPopover({ popoverRef, position, onClose }: Props) {
  const sleepTimerMinutes = usePlayerStore((s) => s.sleepTimerMinutes);
  const sleepTimerEndOfTrack = usePlayerStore((s) => s.sleepTimerEndOfTrack);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const clearSleepTimer = usePlayerStore((s) => s.clearSleepTimer);
  const timerActive = sleepTimerMinutes !== null || sleepTimerEndOfTrack;

  return (
    <div
      ref={popoverRef}
      className="timer-popover"
      style={position ? { right: position.right, bottom: position.bottom } : undefined}
    >
      {PRESET_MINUTES.map((min) => (
        <button
          key={min}
          className={`timer-popover-item${sleepTimerMinutes === min ? " timer-popover-item--active" : ""}`}
          onClick={() => { setSleepTimer(min); onClose(); }}
        >
          {min} min
        </button>
      ))}
      <button
        className={`timer-popover-item${sleepTimerEndOfTrack ? " timer-popover-item--active" : ""}`}
        onClick={() => { setSleepTimer("end-of-track"); onClose(); }}
      >
        End of track
      </button>
      {timerActive && (
        <button
          className="timer-popover-item timer-popover-item--off"
          onClick={() => { clearSleepTimer(); onClose(); }}
        >
          Off
        </button>
      )}
    </div>
  );
}
