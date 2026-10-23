import { Cast, Headphones, MoreHorizontal, Timer } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useOverlayAbove } from "../../../ui/keyboardOwners";
import { useClickOutside } from "../../../ui/useClickOutside";
import { popoverAbove } from "../lib/popoverAbove";
import { usePlayerStore } from "../store/player";
import { VolumeControl } from "./VolumeControl";

interface Props {
  /** Receives the more button, which stays mounted to anchor the popover after the menu closes. */
  onOpenTimer: (anchor: HTMLElement) => void;
  onOpenCast: (anchor: HTMLElement) => void;
  onNowPlaying: () => void;
  timerLabel: string;
  isTimerActive: boolean;
  castDeviceName: string | null;
}

export function PlayerMoreControls({
  onOpenTimer,
  onOpenCast,
  onNowPlaying,
  timerLabel,
  isTimerActive,
  castDeviceName,
}: Props) {
  const isOverlayAbove = useOverlayAbove();
  const [menuPosition, setMenuPosition] = useState<{ right: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = menuPosition !== null;
  const close = () => setMenuPosition(null);

  useClickOutside([menuRef, buttonRef], close, isOpen);

  // An overlay painted over the menu owns Escape.
  useEffect(() => {
    if (!isOpen || isOverlayAbove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPosition(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, isOverlayAbove]);

  // The position is measured once at open, and widening past the breakpoint hides the menu
  // in CSS while it would still count as open, so any resize closes it.
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => setMenuPosition(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen]);

  const handOff = (open: (anchor: HTMLElement) => void) => {
    if (buttonRef.current) open(buttonRef.current);
    close();
  };

  return (
    <>
      <button
        ref={buttonRef}
        className={`player-btn player-btn--icon player-more-btn${isOpen ? " player-btn--active" : ""}${isTimerActive || castDeviceName !== null ? " player-more-btn--has-active" : ""}`}
        onClick={() => {
          if (isOpen) close();
          else if (buttonRef.current) setMenuPosition(popoverAbove(buttonRef.current));
        }}
        title="More controls"
        aria-label="More controls"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={18} />
      </button>
      {menuPosition && (
        <PlayerMoreMenu
          menuRef={menuRef}
          position={menuPosition}
          timerLabel={timerLabel}
          isTimerActive={isTimerActive}
          castDeviceName={castDeviceName}
          onOpenTimer={() => handOff(onOpenTimer)}
          onOpenCast={() => handOff(onOpenCast)}
          onNowPlaying={() => {
            onNowPlaying();
            close();
          }}
        />
      )}
    </>
  );
}

interface MenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  position: { right: number; bottom: number };
  timerLabel: string;
  isTimerActive: boolean;
  castDeviceName: string | null;
  onOpenTimer: () => void;
  onOpenCast: () => void;
  onNowPlaying: () => void;
}

function PlayerMoreMenu({
  menuRef,
  position,
  timerLabel,
  isTimerActive,
  castDeviceName,
  onOpenTimer,
  onOpenCast,
  onNowPlaying,
}: MenuProps) {
  const sleepTimerEndOfTrack = usePlayerStore((s) => s.sleepTimerEndOfTrack);
  // The countdown text trails the timer by an effect, so it can't be what says "Off".
  const timerState = sleepTimerEndOfTrack ? "End of track" : isTimerActive ? timerLabel || "On" : "Off";

  return (
    <div ref={menuRef} className="player-more-menu" style={{ right: position.right, bottom: position.bottom }}>
      <VolumeControl className="player-more-volume" iconSize={16} isLabelled />
      <div className="player-more-separator" />
      <button className="player-more-row" onClick={onOpenTimer}>
        <Timer size={16} className="player-more-row__icon" />
        <span className="player-more-row__label">Sleep timer</span>
        <span className="player-more-row__state">{timerState}</span>
      </button>
      <button className="player-more-row" onClick={onOpenCast}>
        <Cast size={16} className="player-more-row__icon" />
        <span className="player-more-row__label">Cast</span>
        <span className="player-more-row__state">{castDeviceName ?? "This computer"}</span>
      </button>
      <button className="player-more-row" onClick={onNowPlaying}>
        <Headphones size={16} className="player-more-row__icon" />
        <span className="player-more-row__label">Now playing</span>
      </button>
    </div>
  );
}
