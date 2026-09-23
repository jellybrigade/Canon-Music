import { usePlayerStore, RADIO_MODES } from "../../playback/store/player";
import "./RadioQueueStatus.css";

export function RadioQueueStatus() {
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const radioLabel = usePlayerStore((s) => s.radioLabel);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);

  if (!radioActive) return null;

  const name = radioLabel ?? RADIO_MODES.find((m) => m.mode === radioMode)?.label ?? "Radio";

  return (
    <div className="radio-queue-status">
      <span className="radio-queue-status-label">Radio · {name}</span>
      <button className="radio-queue-status-stop" onClick={() => setRadioActive(false)}>
        Stop
      </button>
    </div>
  );
}
