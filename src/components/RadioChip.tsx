import { useState } from "react";
import { usePlayerStore } from "../store/player";
import type { RadioMode } from "../store/player";
import "./RadioChip.css";

const RADIO_MODES: { mode: RadioMode; label: string }[] = [
  { mode: "curated",          label: "Curated" },
  { mode: "same-genre",       label: "Same Genre" },
  { mode: "similar-artists",  label: "Similar Artists" },
  { mode: "same-artist",      label: "Same Artist" },
  { mode: "same-album",       label: "Same Album" },
  { mode: "era",              label: "Same Era" },
  { mode: "loved",            label: "Loved Tracks" },
  { mode: "random",           label: "Random" },
];

export function RadioChip() {
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSeed = usePlayerStore((s) => s.radioSeed);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);
  const setRadioMode = usePlayerStore((s) => s.setRadioMode);
  const [open, setOpen] = useState(false);

  if (!radioActive) return null;

  const modeLabel = RADIO_MODES.find((m) => m.mode === radioMode)?.label ?? "Radio";

  return (
    <div className="radio-chip" onMouseLeave={() => setOpen(false)}>
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
