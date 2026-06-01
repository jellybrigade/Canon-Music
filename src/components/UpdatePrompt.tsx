import { useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { installAndRestart } from "../lib/updater";
import "./UpdatePrompt.css";

interface Props {
  update: Update;
  onDismiss: () => void;
}

export function UpdatePrompt({ update, onDismiss }: Props) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInstall() {
    setInstalling(true);
    setError(null);
    try {
      await installAndRestart(update);
    } catch (e) {
      setInstalling(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="update-prompt-backdrop">
      <div className="update-prompt">
        <p className="update-prompt-title">Update available</p>
        <p className="update-prompt-version">Version {update.version}</p>
        {error && <p className="update-prompt-error">{error}</p>}
        <div className="update-prompt-actions">
          <button
            className="update-prompt-btn"
            onClick={onDismiss}
            disabled={installing}
          >
            Later
          </button>
          <button
            className="update-prompt-btn update-prompt-btn--primary"
            onClick={() => { void handleInstall(); }}
            disabled={installing}
          >
            {installing ? "Installing…" : "Install & Restart"}
          </button>
        </div>
      </div>
    </div>
  );
}
