import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
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

  if (!show("about", "version", "update", "community", "discord", "ko-fi", "kofi")) return null;

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">About</h3>
      <div className="settings-community">
        <span className="settings-community-label">Join the community or support development</span>
        <div className="settings-community-links">
          <button
            className="settings-community-btn"
            onClick={() => void openUrl("https://discord.gg/sYYaJp7xNg")}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M20.32 5.36a18.2 18.2 0 0 0-4.6-1.44.07.07 0 0 0-.08.04c-.2.36-.42.83-.57 1.2a16.8 16.8 0 0 0-5.05 0 8.4 8.4 0 0 0-.58-1.2.07.07 0 0 0-.08-.04c-1.6.28-3.14.77-4.6 1.44a.07.07 0 0 0-.03.03C1.5 9.6.85 13.7 1.17 17.76a.08.08 0 0 0 .03.05 18.3 18.3 0 0 0 5.5 2.79.07.07 0 0 0 .08-.03c.42-.58.8-1.19 1.12-1.83a.07.07 0 0 0-.04-.1 12 12 0 0 1-1.72-.82.07.07 0 0 1 0-.12c.12-.09.23-.18.34-.27a.07.07 0 0 1 .07-.01c3.6 1.65 7.5 1.65 11.07 0a.07.07 0 0 1 .07 0c.11.1.22.19.34.28a.07.07 0 0 1 0 .12c-.55.32-1.12.6-1.72.82a.07.07 0 0 0-.04.1c.33.64.71 1.25 1.12 1.83a.07.07 0 0 0 .08.03 18.2 18.2 0 0 0 5.51-2.79.07.07 0 0 0 .03-.05c.38-4.7-.64-8.76-2.7-12.37a.06.06 0 0 0-.03-.03ZM8.68 15.3c-1.08 0-1.97-1-1.97-2.22s.87-2.21 1.97-2.21 1.99 1 1.97 2.21c0 1.23-.87 2.22-1.97 2.22Zm6.66 0c-1.08 0-1.97-1-1.97-2.22s.87-2.21 1.97-2.21 1.99 1 1.97 2.21c0 1.23-.87 2.22-1.97 2.22Z"
              />
            </svg>
            Discord
          </button>
          <button
            className="settings-community-btn"
            onClick={() => void openUrl("https://ko-fi.com/canonmusic")}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 4a1 1 0 0 0-1 1v9a6 6 0 0 0 6 6h3a6 6 0 0 0 6-6v-.1c1.98-.34 3.5-2.07 3.5-4.15S20.48 5.9 18.5 5.55V5a1 1 0 0 0-1-1H4Zm14.5 3.62c.87.3 1.5 1.13 1.5 2.13s-.63 1.82-1.5 2.12V7.62ZM5 6h12v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V6Z"
              />
            </svg>
            Ko-fi
          </button>
        </div>
      </div>
      <p className="settings-alpha-notice">
        <strong>Canon is in alpha.</strong> Expect bugs, rough edges, and the occasional crash.
        Thanks for trying it out this early, it means a lot.
      </p>
      <div className="settings-diag-row">
        <span className="settings-diag-label">Version</span>
        <span className="settings-diag-value">{appVersion ?? "…"}</span>
      </div>
      <SettingRow title="Auto check for updates">
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={(e) => void setAutoCheck(e.target.checked)}
          />
          <span className="toggle-track" />
        </label>
      </SettingRow>
      <SettingRow title="Check interval" description="How often to check in the background.">
        <select
          className="settings-select"
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
