import { useEffect, useRef, useState } from "react";
import { getDb } from "../../db";
import { authenticate, authenticateWithApiKey } from "../../lib/navidrome";
import type { NavidromeCredential } from "../../lib/navidrome";
import { keychain } from "../../keychain";
import type { Server } from "../../types/server";
import { CanonLockup } from "../CanonIcon";
import { setApiKey as setLastfmApiKey } from "../../lib/lastfm";
import { getFanartApiKey, setFanartApiKey } from "../../lib/fanart";
import { importSettingsFile } from "../../lib/settings-backup";
import { useBoolSetting, useSetting, refreshAllSettings } from "../../hooks/useSetting";
import { SettingRow } from "../settings/SettingRow";
import "../SettingsView.css";
import "./Wizard.css";

interface Props {
  onSuccess: (server: Server) => void;
}

type Step = 1 | 2 | 3 | 4;
type TestState = "idle" | "testing" | "ok" | "error";
type AuthMethod = "password" | "apikey";

interface ConnectionFields {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  authMethod: AuthMethod;
}

function hostnameFrom(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function Wizard({ onSuccess }: Props) {
  const [step, setStep] = useState<Step>(1);

  // Step 2 fields
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState("");
  const [testedSnapshot, setTestedSnapshot] = useState<ConnectionFields | null>(null);
  const [testedCredential, setTestedCredential] = useState<NavidromeCredential | null>(null);

  const [altUrl, setAltUrl] = useState("");

  // Step 3 fields (optional setup)
  const [lastfmKey, setLastfmKeyState] = useState("");
  const [fanartKey, setFanartKeyState] = useState("");
  const [autoCheck, setAutoCheck] = useBoolSetting("updates.auto_check", false);
  const [intervalMin, setIntervalMin] = useSetting("updates.auto_check_interval_min", "60");
  const [autoRefresh, setAutoRefresh] = useBoolSetting("tags.auto_refresh", true);
  const [stalenessDays, setStalenessDays] = useSetting("tags.staleness_days", "30");
  const [importState, setImportState] = useState<"idle" | "done" | "error">("idle");
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getFanartApiKey().then((k) => { if (k) setFanartKeyState(k); }).catch(() => {});
  }, []);

  async function handleSetLastfmKey(k: string) {
    setLastfmKeyState(k);
    await setLastfmApiKey(k);
  }
  async function handleSetFanartKey(k: string) {
    setFanartKeyState(k);
    await setFanartApiKey(k);
  }
  async function handleImportSettings(file: File) {
    try {
      await importSettingsFile(file);
      await refreshAllSettings();
      setImportState("done");
    } catch {
      setImportState("error");
    }
  }

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function handleUrlChange(v: string) {
    setUrl(v);
    if (testState !== "idle") {
      setTestState("idle");
      setTestedSnapshot(null);
      setTestedCredential(null);
    }
    if (!displayName) {
      const h = hostnameFrom(v);
      if (h) setDisplayName(h);
    }
  }

  function handleCredentialChange(key: "username" | "password" | "apiKey", v: string) {
    if (key === "username") setUsername(v);
    else if (key === "apiKey") setApiKey(v);
    else setPassword(v);
    if (testState !== "idle") {
      setTestState("idle");
      setTestedSnapshot(null);
      setTestedCredential(null);
    }
  }

  function handleAuthMethodChange(m: AuthMethod) {
    setAuthMethod(m);
    setTestState("idle");
    setTestedSnapshot(null);
    setTestedCredential(null);
  }

  async function handleTest() {
    setTestState("testing");
    setTestError("");
    try {
      const credential = authMethod === "apikey"
        ? await authenticateWithApiKey(url, username, apiKey)
        : await authenticate(url, username, password);
      setTestState("ok");
      setTestedSnapshot({ url, username, password, apiKey, authMethod });
      setTestedCredential(credential);
    } catch (err) {
      setTestState("error");
      setTestError(err instanceof Error ? err.message : String(err));
    }
  }

  const snapshotMatch =
    testedSnapshot !== null &&
    testedSnapshot.url === url &&
    testedSnapshot.username === username &&
    testedSnapshot.authMethod === authMethod &&
    (authMethod === "apikey" ? testedSnapshot.apiKey === apiKey : testedSnapshot.password === password);

  const canTest = url.trim() !== "" && username.trim() !== "" &&
    (authMethod === "apikey" ? apiKey.trim() !== "" : password.trim() !== "");
  const step2Complete = testState === "ok" && snapshotMatch && displayName.trim() !== "";

  async function handleFinish() {
    if (!testedCredential) return;
    setSaving(true);
    setSaveError("");
    try {
      const id = crypto.randomUUID();
      await keychain.set(`canon.server.${id}`, "credential", JSON.stringify(testedCredential));
      const db = await getDb();
      const trimmedAltUrl = altUrl.trim().replace(/\/+$/, "") || null;
      await db.execute(
        `INSERT INTO servers (id, type, url, alt_url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?, ?)`,
        [
          id,
          url.trim().replace(/\/+$/, ""),
          trimmedAltUrl,
          displayName.trim(),
          username.trim(),
        ]
      );
      const rows = await db.select<Server[]>("SELECT * FROM servers WHERE id = ?", [id]);
      const server = rows[0];
      if (!server) throw new Error("Failed to load saved server");
      onSuccess(server);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="wizard-backdrop">
      <div className="wizard">
        <div className="wizard-steps">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className={`wizard-step-dot${step === s ? " wizard-step-dot--active" : step > s ? " wizard-step-dot--done" : ""}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="wizard-body">
            <CanonLockup height={32} className="wizard-lockup" />
            <h1 className="wizard-title">Welcome to Canon</h1>
            <p className="wizard-desc">
              Canon is a music player for Navidrome that normalizes your tags automatically — genres,
              descriptors, and scenes pulled from Last.fm and your library, organized in the background.
              Your files are never modified.
            </p>
            <p className="wizard-desc">
              To get started, connect Canon to your Navidrome server.
            </p>
            <div className="wizard-actions">
              <button className="primary" onClick={() => setStep(2)}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body">
            <h1 className="wizard-title">Connect your server</h1>

            <div className="wizard-server-types">
              <button className="wizard-server-type wizard-server-type--active">Navidrome</button>
              <button className="wizard-server-type" disabled title="Coming soon">Jellyfin</button>
              <button className="wizard-server-type" disabled title="Coming soon">Plex</button>
            </div>

            <div className="wizard-form">
              <label>
                Server URL
                <input
                  type="url"
                  placeholder="https://music.example.com"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                />
              </label>
              <label>
                Alternate URL <span className="wizard-optional">(optional)</span>
                <input
                  type="url"
                  placeholder="https://music.local:4533"
                  value={altUrl}
                  onChange={(e) => setAltUrl(e.target.value)}
                />
              </label>
              <label>
                Username
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => handleCredentialChange("username", e.target.value)}
                />
              </label>
              <div className="wizard-auth-method">
                <button
                  type="button"
                  className={`wizard-auth-tab${authMethod === "password" ? " wizard-auth-tab--active" : ""}`}
                  onClick={() => handleAuthMethodChange("password")}
                >Password</button>
                <button
                  type="button"
                  className={`wizard-auth-tab${authMethod === "apikey" ? " wizard-auth-tab--active" : ""}`}
                  onClick={() => handleAuthMethodChange("apikey")}
                >API Key</button>
              </div>
              {authMethod === "password" ? (
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => handleCredentialChange("password", e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  API Key
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Your Navidrome API key"
                    value={apiKey}
                    onChange={(e) => handleCredentialChange("apiKey", e.target.value)}
                  />
                </label>
              )}
              <label>
                Display name
                <input
                  type="text"
                  placeholder="My Music"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>

              {testState === "error" && <p className="wizard-error">{testError}</p>}
              {testState === "ok" && snapshotMatch && <p className="wizard-success">Connection successful.</p>}

              <div className="wizard-actions">
                <button
                  type="button"
                  onClick={() => { void handleTest(); }}
                  disabled={!canTest || testState === "testing"}
                >
                  {testState === "testing" ? "Testing…" : "Test connection"}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setStep(3)}
                  disabled={!step2Complete}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-body">
            <h1 className="wizard-title">Optional setup</h1>
            <p className="wizard-desc">
              Everything below is optional and can be changed later in Settings.
            </p>

            <section className="settings-section">
              <h3 className="settings-section-title">Last.fm</h3>
              <SettingRow title="API key" stacked>
                <input
                  type="text"
                  placeholder="Paste your Last.fm API key"
                  value={lastfmKey}
                  onChange={(e) => { void handleSetLastfmKey(e.target.value); }}
                />
              </SettingRow>
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">Fanart.tv</h3>
              <SettingRow title="API key" stacked>
                <input
                  type="text"
                  placeholder="Paste your Fanart.tv API key"
                  value={fanartKey}
                  onChange={(e) => { void handleSetFanartKey(e.target.value); }}
                />
              </SettingRow>
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">Auto-refresh</h3>
              <SettingRow title="Auto-refresh metadata on launch">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => { void setAutoRefresh(e.target.checked); }}
                />
              </SettingRow>
              <SettingRow title="Stale after (days)">
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={stalenessDays}
                  onChange={(e) => { void setStalenessDays(e.target.value); }}
                  className="settings-staleness-input"
                />
              </SettingRow>
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">Updates</h3>
              <SettingRow title="Auto check for updates">
                <input
                  type="checkbox"
                  checked={autoCheck}
                  onChange={(e) => { void setAutoCheck(e.target.checked); }}
                />
              </SettingRow>
              <SettingRow title="Check interval">
                <select
                  className="settings-select"
                  value={intervalMin}
                  disabled={!autoCheck}
                  onChange={(e) => { void setIntervalMin(e.target.value); }}
                >
                  <option value="10">Every 10 minutes</option>
                  <option value="30">Every 30 minutes</option>
                  <option value="60">Every hour</option>
                  <option value="360">Every 6 hours</option>
                  <option value="1440">Every day</option>
                </select>
              </SettingRow>
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">Import settings</h3>
              <p className="settings-section-desc">Restore a previously exported settings backup.</p>
              <div className="settings-field settings-field--row">
                <button className="settings-btn" onClick={() => importInputRef.current?.click()}>
                  Import settings
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportSettings(file);
                    e.target.value = "";
                  }}
                />
                {importState === "done" && <span className="settings-hint">Imported.</span>}
                {importState === "error" && <span className="settings-hint">Import failed.</span>}
              </div>
            </section>

            <div className="wizard-actions">
              <button type="button" onClick={() => setStep(4)}>I&rsquo;ll do it later</button>
              <button type="button" className="primary" onClick={() => setStep(4)}>Continue</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="wizard-body">
            <h1 className="wizard-title">You&rsquo;re all set</h1>
            <p className="wizard-desc">
              Library syncing in background — start listening.
            </p>
            {saveError && <p className="wizard-error">{saveError}</p>}
            <div className="wizard-actions">
              <button
                type="button"
                className="primary"
                onClick={() => { void handleFinish(); }}
                disabled={saving}
              >
                {saving ? "Opening…" : "Open Canon"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
