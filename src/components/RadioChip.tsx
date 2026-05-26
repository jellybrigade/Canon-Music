import { useState } from "react";
import { usePlayerStore } from "../store/player";

export function RadioChip() {
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSeed = usePlayerStore((s) => s.radioSeed);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);
  const [open, setOpen] = useState(false);

  if (!radioActive) return null;

  return (
    <div className="radio-chip">
      <button
        className="radio-chip-btn"
        onClick={() => setOpen((v) => !v)}
        title="Radio active"
      >
        Radio ●
      </button>
      {open && (
        <div className="radio-chip-popover" onClick={(e) => e.stopPropagation()}>
          {radioSeed && (
            <p className="radio-chip-seed">Seeded from: {radioSeed.title}</p>
          )}
          <button
            className="radio-chip-stop"
            onClick={() => { setRadioActive(false); setOpen(false); }}
          >
            Stop radio
          </button>
        </div>
      )}
    </div>
  );
}
