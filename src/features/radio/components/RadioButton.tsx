import { useRef, useState } from "react";
import { Radio } from "lucide-react";
import { useClickOutside } from "../../../ui/useClickOutside";
import { useStartRadio } from "../hooks/useStartRadio";
import { usePlayerStore } from "../../playback/store/player";
import { RADIO_MODES } from "../../playback/store/playerTypes";
import "./RadioButton.css";

export function RadioButton({ iconSize = 18 }: { iconSize?: number }) {
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSeedTitle = usePlayerStore((s) => s.radioSeed?.title ?? null);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const radioLabel = usePlayerStore((s) => s.radioLabel);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null && s.streamUrlFor !== null);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);
  const setRadioMode = usePlayerStore((s) => s.setRadioMode);
  const startRadio = useStartRadio();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapRef, () => setOpen(false), open);

  function handleClick() {
    if (radioActive) {
      setOpen((v) => !v);
      return;
    }
    const { currentTrack, streamUrlFor } = usePlayerStore.getState();
    if (!currentTrack || !streamUrlFor) return;
    void startRadio({ tracks: [], seed: currentTrack, streamUrlFor });
  }

  const modeLabel = RADIO_MODES.find((m) => m.mode === radioMode)?.label ?? "Radio";
  const label = radioActive ? `Radio: ${radioLabel ?? modeLabel}` : "Start radio";
  const title = radioActive && radioSeedTitle ? `${label} · Seeded from ${radioSeedTitle}` : label;

  return (
    <div className="radio-btn-wrap" ref={wrapRef}>
      <button
        className={`radio-btn player-btn player-btn--icon${radioActive ? " player-btn--active" : ""}`}
        onClick={handleClick}
        disabled={!radioActive && !hasTrack}
        title={title}
        aria-label={label}
        aria-haspopup={radioActive ? "menu" : undefined}
        aria-expanded={radioActive ? open : undefined}
      >
        <Radio size={iconSize} />
      </button>
      {open && radioActive && (
        <div className="radio-menu" role="menu">
          {RADIO_MODES.map(({ mode, label: itemLabel }) => (
            <button
              key={mode}
              role="menuitem"
              className={`radio-menu-item${radioMode === mode ? " radio-menu-item--active" : ""}`}
              onClick={() => { setRadioMode(mode); setOpen(false); }}
            >
              {itemLabel}
            </button>
          ))}
          <div className="radio-menu-divider" />
          <button
            role="menuitem"
            className="radio-menu-item radio-menu-item--stop"
            onClick={() => { setRadioActive(false); setOpen(false); }}
          >
            Stop radio
          </button>
        </div>
      )}
    </div>
  );
}
