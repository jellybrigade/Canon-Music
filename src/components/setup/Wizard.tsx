import { useState } from "react";
import { getDb } from "../../db";
import { authenticate } from "../../lib/navidrome";
import type { NavidromeCredential } from "../../lib/navidrome";
import { keychain } from "../../keychain";
import type { Server } from "../../types/server";
import { CanonLockup } from "../CanonIcon";
import "./Wizard.css";

interface Props {
  onSuccess: (server: Server) => void;
}

type Step = 1 | 2 | 3;
type TestState = "idle" | "testing" | "ok" | "error";

interface ConnectionFields {
  url: string;
  username: string;
  password: string;
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
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState("");
  const [testedSnapshot, setTestedSnapshot] = useState<ConnectionFields | null>(null);
  const [testedCredential, setTestedCredential] = useState<NavidromeCredential | null>(null);

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

  function handleCredentialChange(key: "username" | "password", v: string) {
    if (key === "username") setUsername(v);
    else setPassword(v);
    if (testState !== "idle") {
      setTestState("idle");
      setTestedSnapshot(null);
      setTestedCredential(null);
    }
  }

  async function handleTest() {
    setTestState("testing");
    setTestError("");
    try {
      const credential = await authenticate(url, username, password);
      setTestState("ok");
      setTestedSnapshot({ url, username, password });
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
    testedSnapshot.password === password;

  const canTest = url.trim() !== "" && username.trim() !== "" && password.trim() !== "";
  const step2Complete = testState === "ok" && snapshotMatch && displayName.trim() !== "";

  async function handleFinish() {
    if (!testedCredential) return;
    setSaving(true);
    setSaveError("");
    try {
      const id = crypto.randomUUID();
      await keychain.set(`canon.server.${id}`, "credential", JSON.stringify(testedCredential));
      const db = await getDb();
      await db.execute(
        `INSERT INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?)`,
        [
          id,
          url.trim().replace(/\/+$/, ""),
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
          {([1, 2, 3] as Step[]).map((s) => (
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
                Username
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => handleCredentialChange("username", e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => handleCredentialChange("password", e.target.value)}
                />
              </label>
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
