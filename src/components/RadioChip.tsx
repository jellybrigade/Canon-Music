import { usePlayerStore } from "../store/player";
import "./RadioChip.css";

export function RadioChip() {
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSeed = usePlayerStore((s) => s.radioSeed);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);

  if (!radioActive) return null;

  return (
    <button
      className="radio-chip-btn"
      onClick={() => setRadioActive(false)}
      title={radioSeed ? `Radio seeded from: ${radioSeed.title} — click to stop` : "Radio active — click to stop"}
    >
      Radio ●
    </button>
  );
}
