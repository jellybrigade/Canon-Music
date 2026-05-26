import { useState } from "react";
import { getDb } from "../db";
import { authenticate } from "../lib/navidrome";
import type { NavidromeCredential } from "../lib/navidrome";
import { checkSidecarHealth } from "../lib/sidecar";
import { keychain } from "../keychain";
import type { Server } from "../types/server";

interface Props {
  onSuccess: (server: Server) => void;
}

interface Fields {
  displayName: string;
  url: string;
  username: string;
  password: string;
  sidecarUrl: string;
  sidecarSecret: string;
  sidecarPathFrom: string;
  sidecarPathTo: string;
}

type ConnectionFields = Pick<Fields, "url" | "username" | "password">;

type TestState = "idle" | "testing" | "ok" | "error";
type SidecarTestState = "idle" | "testing" | "ok" | "error";

export function AddServerModal({ onSuccess }: Props) {
  const [fields, setFields] = useState<Fields>({
    displayName: "",
    url: "",
    username: "",
    password: "",
    sidecarUrl: "",
    sidecarSecret: "",
    sidecarPathFrom: "",
    sidecarPathTo: "",
  });
  const [testState, setTestState] = useState<TestState>("idle");
  const [sidecarTestState, setSidecarTestState] = useState<SidecarTestState>("idle");
  const [sidecarTestError, setSidecarTestError] = useState<string>("");
  const [testError, setTestError] = useState<string>("");
  const [testedSnapshot, setTestedSnapshot] = useState<ConnectionFields | null>(null);
  const [testedCredential, setTestedCredential] = useState<NavidromeCredential | null>(null);
  const [saving, setSaving] = useState(false);

  function update(key: keyof Fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    if (key !== "displayName" && key !== "sidecarUrl" && key !== "sidecarSecret" && key !== "sidecarPathFrom" && key !== "sidecarPathTo" && testState !== "idle") {
      setTestState("idle");
      setTestedSnapshot(null);
      setTestedCredential(null);
    }
    if (key === "sidecarUrl" || key === "sidecarSecret") {
      setSidecarTestState("idle");
    }
  }

  async function handleTestSidecar() {
    if (!fields.sidecarUrl.trim() || !fields.sidecarSecret.trim()) return;
    setSidecarTestState("testing");
    setSidecarTestError("");
    try {
      await checkSidecarHealth(fields.sidecarUrl.trim(), fields.sidecarSecret.trim());
      setSidecarTestState("ok");
    } catch (err) {
      setSidecarTestState("error");
      setSidecarTestError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTest() {
    setTestState("testing");
    setTestError("");
    try {
      const credential = await authenticate(fields.url, fields.username, fields.password);
      setTestState("ok");
      setTestedSnapshot({ url: fields.url, username: fields.username, password: fields.password });
      setTestedCredential(credential);
    } catch (err) {
      setTestState("error");
      setTestError(err instanceof Error ? err.message : String(err));
    }
  }

  const canTest =
    fields.url.trim() !== "" &&
    fields.username.trim() !== "" &&
    fields.password.trim() !== "";

  const snapshotMatch =
    testedSnapshot !== null &&
    testedSnapshot.url === fields.url &&
    testedSnapshot.username === fields.username &&
    testedSnapshot.password === fields.password;

  const canSave =
    testState === "ok" &&
    snapshotMatch &&
    fields.displayName.trim() !== "" &&
    !saving;

  async function handleSave() {
    if (!testedCredential) return;
    setSaving(true);
    try {
      const credential = testedCredential;
      const id = crypto.randomUUID();
      await keychain.set(
        `canon.server.${id}`,
        "credential",
        JSON.stringify(credential)
      );
      const hasSidecar = fields.sidecarUrl.trim() !== "" && fields.sidecarSecret.trim() !== "";
      if (hasSidecar) {
        await keychain.set(`canon.sidecar.${id}`, "secret", fields.sidecarSecret.trim());
      }
      const db = await getDb();
      await db.execute(
        `INSERT INTO servers (id, type, url, display_name, username, sidecar_url, sidecar_secret_key, sidecar_path_prefix_from, sidecar_path_prefix_to)
         VALUES (?, 'navidrome', ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          fields.url.trim().replace(/\/+$/, ""),
          fields.displayName.trim(),
          fields.username.trim(),
          hasSidecar ? fields.sidecarUrl.trim() : null,
          hasSidecar ? `canon.sidecar.${id}` : null,
          fields.sidecarPathFrom.trim() || null,
          fields.sidecarPathTo.trim() || null,
        ]
      );
      const rows = await db.select<Server[]>(
        "SELECT * FROM servers WHERE id = ?",
        [id]
      );
      const server = rows[0];
      if (!server) throw new Error("Failed to load saved server");
      onSuccess(server);
    } catch (err) {
      setTestState("error");
      setTestError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="setup-screen">
      <h1>Add a server</h1>
      <p className="setup-subtitle">Connect Canon to your Navidrome server.</p>

      <div className="form">
        <label>
          Display name
          <input
            type="text"
            placeholder="My Music"
            value={fields.displayName}
            onChange={(e) => update("displayName", e.target.value)}
          />
        </label>

        <label>
          Server URL
          <input
            type="url"
            placeholder="https://music.example.com"
            value={fields.url}
            onChange={(e) => update("url", e.target.value)}
          />
        </label>

        <label>
          Username
          <input
            type="text"
            autoComplete="username"
            value={fields.username}
            onChange={(e) => update("username", e.target.value)}
          />
        </label>

        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={fields.password}
            onChange={(e) => update("password", e.target.value)}
          />
        </label>

        {testState === "error" && (
          <p className="form-error">{testError}</p>
        )}

        {testState === "ok" && snapshotMatch && (
          <p className="form-success">Connection successful.</p>
        )}

        <details className="form-optional-section">
          <summary>Sidecar (optional — enables tag editing)</summary>

          <label>
            Sidecar URL
            <input
              type="url"
              placeholder="http://localhost:8765"
              value={fields.sidecarUrl}
              onChange={(e) => update("sidecarUrl", e.target.value)}
            />
          </label>

          <label>
            Sidecar secret
            <input
              type="password"
              autoComplete="off"
              value={fields.sidecarSecret}
              onChange={(e) => update("sidecarSecret", e.target.value)}
            />
          </label>

          <label>
            Path remap: from
            <input
              type="text"
              placeholder="/mnt/music"
              value={fields.sidecarPathFrom}
              onChange={(e) => update("sidecarPathFrom", e.target.value)}
            />
          </label>

          <label>
            Path remap: to
            <input
              type="text"
              placeholder="/music"
              value={fields.sidecarPathTo}
              onChange={(e) => update("sidecarPathTo", e.target.value)}
            />
          </label>

          {sidecarTestState === "error" && (
            <p className="form-error">{sidecarTestError}</p>
          )}
          {sidecarTestState === "ok" && (
            <p className="form-success">Sidecar reachable.</p>
          )}

          <button
            type="button"
            onClick={handleTestSidecar}
            disabled={!fields.sidecarUrl.trim() || !fields.sidecarSecret.trim() || sidecarTestState === "testing"}
          >
            {sidecarTestState === "testing" ? "Testing sidecar…" : "Test sidecar"}
          </button>
        </details>

        <div className="form-actions">
          <button
            type="button"
            onClick={handleTest}
            disabled={!canTest || testState === "testing"}
          >
            {testState === "testing" ? "Testing…" : "Test connection"}
          </button>

          <button
            type="button"
            className="primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
