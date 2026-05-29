import { useState } from "react";
import { getDb } from "../../db";
import { authenticate } from "../../lib/navidrome";
import type { NavidromeCredential } from "../../lib/navidrome";
import { checkSidecarHealth, probeSidecar } from "../../lib/sidecar";
import { keychain } from "../../keychain";
import type { Server } from "../../types/server";
import "./Wizard.css";

interface Props {
  onSuccess: (server: Server) => void;
}

type Step = 1 | 2 | 3 | 4;
type TestState = "idle" | "testing" | "ok" | "error";
type SidecarMode = "none" | "auto-detect" | "manual" | "skip";

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

  // Step 3 fields
  const [sidecarMode, setSidecarMode] = useState<SidecarMode>("none");
  const [sidecarUrl, setSidecarUrl] = useState("");
  const [sidecarSecret, setSidecarSecret] = useState("");
  const [sidecarPathFrom, setSidecarPathFrom] = useState("");
  const [sidecarPathTo, setSidecarPathTo] = useState("");
  const [sidecarTestState, setSidecarTestState] = useState<TestState>("idle");
  const [sidecarTestError, setSidecarTestError] = useState("");
  const [probing, setProbing] = useState(false);

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

  async function handleAutoDetect() {
    const host = hostnameFrom(url);
    if (!host) return;
    setProbing(true);
    setSidecarTestError("");
    setSidecarTestState("idle");
    try {
      const result = await probeSidecar(host);
      setSidecarUrl(result.url);
      setSidecarMode("manual");
      setSidecarTestState("ok");
    } catch (err) {
      setSidecarTestError(err instanceof Error ? err.message : String(err));
      setSidecarTestState("error");
      setSidecarMode("manual");
    } finally {
      setProbing(false);
    }
  }

  async function handleTestSidecar() {
    if (!sidecarUrl.trim() || !sidecarSecret.trim()) return;
    setSidecarTestState("testing");
    setSidecarTestError("");
    try {
      await checkSidecarHealth(sidecarUrl.trim(), sidecarSecret.trim());
      setSidecarTestState("ok");
    } catch (err) {
      setSidecarTestState("error");
      setSidecarTestError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSidecarUrlChange(v: string) {
    setSidecarUrl(v);
    setSidecarTestState("idle");
  }

  function handleSidecarSecretChange(v: string) {
    setSidecarSecret(v);
    setSidecarTestState("idle");
  }

  const snapshotMatch =
    testedSnapshot !== null &&
    testedSnapshot.url === url &&
    testedSnapshot.username === username &&
    testedSnapshot.password === password;

  const canTest = url.trim() !== "" && username.trim() !== "" && password.trim() !== "";
  const step2Complete = testState === "ok" && snapshotMatch && displayName.trim() !== "";

  const hasSidecar = sidecarMode === "manual" && sidecarUrl.trim() !== "" && sidecarSecret.trim() !== "";
  const step3Complete = sidecarMode === "skip" || sidecarMode === "none" || (hasSidecar && sidecarTestState === "ok");

  async function handleFinish() {
    if (!testedCredential) return;
    setSaving(true);
    setSaveError("");
    try {
      const id = crypto.randomUUID();
      await keychain.set(`canon.server.${id}`, "credential", JSON.stringify(testedCredential));
      if (hasSidecar) {
        await keychain.set(`canon.sidecar.${id}`, "secret", sidecarSecret.trim());
      }
      const db = await getDb();
      await db.execute(
        `INSERT INTO servers (id, type, url, display_name, username, sidecar_url, sidecar_secret_key, sidecar_path_prefix_from, sidecar_path_prefix_to)
         VALUES (?, 'navidrome', ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          url.trim().replace(/\/+$/, ""),
          displayName.trim(),
          username.trim(),
          hasSidecar ? sidecarUrl.trim() : null,
          hasSidecar ? `canon.sidecar.${id}` : null,
          sidecarPathFrom.trim() || null,
          sidecarPathTo.trim() || null,
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
            <h1 className="wizard-title">Welcome to Canon</h1>
            <p className="wizard-desc">
              Canon is a music player for Navidrome that normalizes your tags automatically — genres,
              descriptors, and scenes pulled from Last.fm and your library, organized in the background.
              Your files are never modified unless you explicitly ask.
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
            <h1 className="wizard-title">Enable tag editing (optional)</h1>
            <p className="wizard-desc">
              Canon can clean up tags directly on your music files. To do this it needs a small helper
              service ("sidecar") running next to your music server. If you skip this, Canon still works
              as a player and shows normalized tags inside the app — your files stay untouched.
            </p>

            {sidecarMode === "none" && (
              <div className="wizard-sidecar-options">
                <button
                  type="button"
                  onClick={() => { void handleAutoDetect(); }}
                  disabled={probing || !hostnameFrom(url)}
                >
                  {probing ? "Detecting…" : "Auto-detect sidecar"}
                </button>
                <button type="button" onClick={() => setSidecarMode("manual")}>
                  Set up manually
                </button>
                <button type="button" onClick={() => setSidecarMode("skip")}>
                  Skip for now
                </button>
              </div>
            )}

            {sidecarMode === "manual" && (
              <div className="wizard-form">
                <label>
                  Sidecar URL
                  <input
                    type="url"
                    placeholder="http://localhost:8765"
                    value={sidecarUrl}
                    onChange={(e) => handleSidecarUrlChange(e.target.value)}
                  />
                </label>
                <label>
                  Shared secret
                  <input
                    type="password"
                    autoComplete="off"
                    value={sidecarSecret}
                    onChange={(e) => handleSidecarSecretChange(e.target.value)}
                  />
                </label>
                <details className="wizard-path-remap">
                  <summary>Path remapping (advanced)</summary>
                  <label>
                    From
                    <input
                      type="text"
                      placeholder="/mnt/music"
                      value={sidecarPathFrom}
                      onChange={(e) => setSidecarPathFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="text"
                      placeholder="/music"
                      value={sidecarPathTo}
                      onChange={(e) => setSidecarPathTo(e.target.value)}
                    />
                  </label>
                </details>

                <details className="wizard-docker-hint">
                  <summary>Docker command</summary>
                  <pre className="wizard-docker-cmd">{`docker run -d \\
  -v /path/to/music:/music \\
  -e SIDECAR_SECRET=your-secret \\
  -p 8765:8765 \\
  ghcr.io/jellybrigade/canon-sidecar`}</pre>
                </details>

                {sidecarTestState === "error" && <p className="wizard-error">{sidecarTestError}</p>}
                {sidecarTestState === "ok" && <p className="wizard-success">Sidecar reachable.</p>}

                <div className="wizard-actions">
                  <button type="button" onClick={() => { setSidecarMode("none"); setSidecarTestState("idle"); }}>
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleTestSidecar(); }}
                    disabled={!sidecarUrl.trim() || !sidecarSecret.trim() || sidecarTestState === "testing"}
                  >
                    {sidecarTestState === "testing" ? "Testing…" : "Test sidecar"}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setStep(4)}
                    disabled={!step3Complete}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {sidecarMode === "skip" && (
              <div className="wizard-skip-confirm">
                <p className="wizard-success">Skipping sidecar — tags shown in app only, files untouched.</p>
                <div className="wizard-actions">
                  <button type="button" onClick={() => setSidecarMode("none")}>Back</button>
                  <button type="button" className="primary" onClick={() => setStep(4)}>Continue</button>
                </div>
              </div>
            )}

            {sidecarMode === "none" && (
              <div className="wizard-actions" style={{ marginTop: "1rem" }}>
                <button type="button" onClick={() => setStep(2)}>Back</button>
              </div>
            )}
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
