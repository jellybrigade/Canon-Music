import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, installAndRestart } from "../../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { useBoolSetting, useSetting } from "../../hooks/useSetting";
import { SettingRow } from "./SettingRow";

interface Props {
  searchQuery: string;
}

export function AboutTab({ searchQuery }: Props) {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateCheckState, setUpdateCheckState] = useState<"idle" | "checking" | "up-to-date" | "available" | "error">("idle");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [autoCheck, setAutoCheck] = useBoolSetting("updates.auto_check", false);
  const [intervalMin, setIntervalMin] = useSetting("updates.auto_check_interval_min", "60");

  useEffect(() => { void getVersion().then(setAppVersion); }, []);

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some(l => l.toLowerCase().includes(fl));

  if (!show("about", "version", "update")) return null;

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">About</h3>
      <div className="settings-diag-row">
        <span className="settings-diag-label">Version</span>
        <span className="settings-diag-value">{appVersion ?? "…"}</span>
      </div>
      <SettingRow title="Auto check for updates">
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => void setAutoCheck(e.target.checked)}
        />
      </SettingRow>
      <SettingRow title="Check interval" description="How often to check in the background.">
        <select
          value={intervalMin}
          disabled={!autoCheck}
          onChange={(e) => void setIntervalMin(e.target.value)}
        >
          <option value="10">Every 10 minutes</option>
          <option value="30">Every 30 minutes</option>
          <option value="60">Every hour</option>
          <option value="360">Every 6 hours</option>
          <option value="1440">Every day</option>
        </select>
      </SettingRow>
      <div className="settings-field settings-field--row" style={{ marginTop: "0.75rem" }}>
        {updateCheckState !== "available" ? (
          <button
            className="settings-btn"
            disabled={updateCheckState === "checking" || updateInstalling}
            onClick={() => {
              setUpdateCheckState("checking");
              setPendingUpdate(null);
              void checkForUpdate().then((u) => {
                if (u) { setPendingUpdate(u); setUpdateCheckState("available"); }
                else setUpdateCheckState("up-to-date");
              }).catch(() => setUpdateCheckState("error"));
            }}
          >
            {updateCheckState === "checking" ? "Checking…" : "Check for updates"}
          </button>
        ) : null}
        {updateCheckState === "up-to-date" && (
          <span className="settings-hint">You're up to date.</span>
        )}
        {updateCheckState === "error" && (
          <span className="settings-hint" style={{ color: "var(--color-error, #e05050)" }}>
            Couldn't check for updates.
          </span>
        )}
        {updateCheckState === "available" && pendingUpdate && (
          <>
            <span className="settings-hint">Update available: {pendingUpdate.version}</span>
            <button
              className="settings-btn primary"
              disabled={updateInstalling}
              onClick={() => {
                setUpdateInstalling(true);
                void installAndRestart(pendingUpdate, () => {}).catch(() => setUpdateInstalling(false));
              }}
            >
              {updateInstalling ? "Installing…" : "Install & Restart"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
