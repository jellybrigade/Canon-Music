import { useState } from "react";
import { createPortal } from "react-dom";
import { Radio, X } from "lucide-react";
import { usePlayerStore } from "../../playback/store/player";
import { type RadioStartAction, type RadioStartRequest } from "../../playback/store/playerTypes";
import { useRadioStartStore } from "../store/radioStart";
import { useSetting } from "../../../hooks/useSetting";
import { RADIO_START_ACTION_SETTING } from "../hooks/useStartRadio";
import { useOverlayDismiss } from "../../../ui/useOverlayDismiss";
import { useModalChrome } from "../../../ui/useModalChrome";
import "./RadioStartDialog.css";

export function RadioStartDialogHost() {
  const pending = useRadioStartStore((s) => s.pending);
  if (!pending) return null;
  return <RadioStartDialog request={pending} />;
}

function RadioStartDialog({ request }: { request: RadioStartRequest }) {
  const dismiss = useRadioStartStore((s) => s.dismiss);
  const [, setStartAction] = useSetting(RADIO_START_ACTION_SETTING, "ask");
  const [remember, setRemember] = useState(false);
  // Read once: the count only frames the question, and a subscription would re-render the
  // dialog every time radio appends behind it.
  const [queueLength] = useState(() => usePlayerStore.getState().queue.length);
  const backdrop = useOverlayDismiss(dismiss);
  const chrome = useModalChrome(dismiss);

  function choose(action: RadioStartAction) {
    dismiss();
    if (remember) void setStartAction(action);
    void usePlayerStore.getState().startRadioFrom(action, request);
  }

  return createPortal(
    <div className="radio-start-overlay" {...backdrop}>
      <div className="radio-start-dialog" {...chrome} aria-label="Start radio">
        <div className="radio-start-header">
          <h2 className="radio-start-title">
            <Radio size={16} />
            Start radio
          </h2>
          <button className="radio-start-close" onClick={dismiss} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="radio-start-body">
          <p className="radio-start-description">
            Your queue has {queueLength} {queueLength === 1 ? "track" : "tracks"}. Replace it, or let radio
            continue after it?
          </p>
        </div>

        <div className="radio-start-footer">
          <label className="radio-start-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Always do this
          </label>
          <div className="radio-start-actions">
            <button className="radio-start-btn" onClick={() => choose("queue_last")}>Add to queue</button>
            <button className="radio-start-btn radio-start-btn--primary" onClick={() => choose("replace")} autoFocus>
              Replace queue
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
