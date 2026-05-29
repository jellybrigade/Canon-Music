import { useEffect, useRef, useState } from "react";
import { usePlayerStore, RADIO_MODES } from "../store/player";
import "./RadioChip.css";

export function RadioChip() {
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSeed = usePlayerStore((s) => s.radioSeed);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);
  const setRadioMode = usePlayerStore((s) => s.setRadioMode);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (chipRef.current && !chipRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  if (!radioActive) return null;

  const modeLabel = RADIO_MODES.find((m) => m.mode === radioMode)?.label ?? "Radio";

  return (
    <div className="radio-chip" ref={chipRef}>
      <button
        className="radio-chip-btn"
        onClick={() => setOpen((v) => !v)}
        title={radioSeed ? `Radio seeded from: ${radioSeed.title}` : "Radio active"}
      >
        Radio: {modeLabel} ●
      </button>
      {open && (
        <div className="radio-chip-menu">
          {RADIO_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={`radio-chip-menu-item${radioMode === mode ? " radio-chip-menu-item--active" : ""}`}
              onClick={() => { setRadioMode(mode); setOpen(false); }}
            >
              {label}
            </button>
          ))}
          <div className="radio-chip-menu-divider" />
          <button
            className="radio-chip-menu-item radio-chip-menu-item--stop"
            onClick={() => { setRadioActive(false); setOpen(false); }}
          >
            Stop radio
          </button>
        </div>
      )}
    </div>
  );
}
