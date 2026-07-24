import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QK } from "../../lib/query-keys";
import { authenticate, authenticateWithApiKey, fetchAndStoreOpenSubsonicExtensions } from "../../lib/navidrome";
import type { NavidromeCredential } from "../../lib/navidrome";
import { keychain } from "../../keychain";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { Server as ServerRow } from "../../types/server";

type TestState = "idle" | "testing" | "ok" | "error";
type AuthMethod = "password" | "apikey";

interface Props {
  server: ServerRow | undefined;
  serverWithCredential: ServerWithCredential | undefined;
  onRemoveServer: () => void;
  searchQuery: string;
}

export function ServerTab({ server, serverWithCredential, onRemoveServer, searchQuery }: Props) {
  const hasCredential = !!serverWithCredential;
  const queryClient = useQueryClient();

  const [serverEditing, setServerEditing] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editAltUrl, setEditAltUrl] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editAuthMethod, setEditAuthMethod] = useState<AuthMethod>("password");
  const [serverTestState, setServerTestState] = useState<TestState>("idle");
  const [serverTestError, setServerTestError] = useState("");
  const [serverTestedSnapshot, setServerTestedSnapshot] = useState<{ url: string; username: string; password: string; apiKey: string; authMethod: AuthMethod } | null>(null);
  const [serverTestedCredential, setServerTestedCredential] = useState<NavidromeCredential | null>(null);
  const [serverSaving, setServerSaving] = useState(false);
  const [serverSaveError, setServerSaveError] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState(false);

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some(l => l.toLowerCase().includes(fl));

  function beginEditServer() {
    setEditUrl(server?.url ?? "");
    setEditAltUrl(server?.alt_url ?? "");
    setEditDisplayName(server?.display_name ?? "");
    setEditUsername(server?.username ?? "");
    setEditPassword("");
    setEditApiKey("");
    setEditAuthMethod("password");
    setServerTestState("idle");
    setServerTestError("");
    setServerTestedSnapshot(null);
    setServerTestedCredential(null);
    setServerSaveError("");
    setServerEditing(true);
  }

  function handleEditCredentialChange(key: "url" | "altUrl" | "username" | "password" | "apiKey", v: string) {
    if (key === "url") setEditUrl(v);
    else if (key === "altUrl") { setEditAltUrl(v); return; }
    else if (key === "username") setEditUsername(v);
    else if (key === "apiKey") setEditApiKey(v);
    else setEditPassword(v);
    setServerTestState("idle");
    setServerTestedSnapshot(null);
    setServerTestedCredential(null);
  }

  function handleEditAuthMethodChange(m: AuthMethod) {
    setEditAuthMethod(m);
    setServerTestState("idle");
    setServerTestedSnapshot(null);
    setServerTestedCredential(null);
  }

  async function handleServerTest() {
    setServerTestState("testing");
    setServerTestError("");
    try {
      const cred = editAuthMethod === "apikey"
        ? await authenticateWithApiKey(editUrl, editUsername, editApiKey)
        : await authenticate(editUrl, editUsername, editPassword);
      setServerTestState("ok");
      setServerTestedSnapshot({ url: editUrl, username: editUsername, password: editPassword, apiKey: editApiKey, authMethod: editAuthMethod });
      setServerTestedCredential(cred);
    } catch (err) {
      setServerTestState("error");
      setServerTestError(err instanceof Error ? err.message : String(err));
    }
  }

  const serverSnapshotMatch =
    serverTestedSnapshot !== null &&
    serverTestedSnapshot.url === editUrl &&
    serverTestedSnapshot.username === editUsername &&
    serverTestedSnapshot.authMethod === editAuthMethod &&
    (editAuthMethod === "apikey" ? serverTestedSnapshot.apiKey === editApiKey : serverTestedSnapshot.password === editPassword);

  const canTestServer = editUrl.trim() !== "" && editUsername.trim() !== "" &&
    (editAuthMethod === "apikey" ? editApiKey.trim() !== "" : editPassword.trim() !== "");
  const canSaveServer =
    serverTestState === "ok" &&
    serverSnapshotMatch &&
    editDisplayName.trim() !== "" &&
    !serverSaving;

  async function handleSaveServer() {
    if (!serverTestedCredential) return;
    setServerSaving(true);
    setServerSaveError("");
    try {
      const id = server?.id ?? crypto.randomUUID();
      await keychain.set(`canon.server.${id}`, "credential", JSON.stringify(serverTestedCredential));
      const db = await getDb();
      const cleanUrl = editUrl.trim().replace(/\/+$/, "");
      const cleanAltUrl = editAltUrl.trim().replace(/\/+$/, "") || null;
      const cleanDisplayName = editDisplayName.trim();
      const cleanUsername = editUsername.trim();
      if (server) {
        await db.execute(
          "UPDATE servers SET url=?, alt_url=?, display_name=?, username=? WHERE id=?",
          [cleanUrl, cleanAltUrl, cleanDisplayName, cleanUsername, id]
        );
      } else {
        await db.execute(
          "INSERT INTO servers (id, type, url, alt_url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?, ?)",
          [id, cleanUrl, cleanAltUrl, cleanDisplayName, cleanUsername]
        );
      }
      void fetchAndStoreOpenSubsonicExtensions(
        cleanUrl,
        cleanUsername,
        serverTestedCredential,
        id,
        cleanAltUrl ?? undefined
      );
      await queryClient.invalidateQueries({ queryKey: QK.servers() });
      await queryClient.invalidateQueries({ queryKey: QK.serverCredential(id) });
      setServerEditing(false);
    } catch (err) {
      setServerSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setServerSaving(false);
    }
  }

  async function handleRemoveServer() {
    if (!server) return;
    const db = await getDb();
    await db.execute("DELETE FROM servers WHERE id=?", [server.id]);
    try {
      await keychain.delete(`canon.server.${server.id}`, "credential");
    } catch { /* not fatal */ }
    onRemoveServer();
  }

  if (!show("server", "url", "username", "password", "display name", "connection")) return null;

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Server</h3>
      {!serverEditing ? (
        server && hasCredential ? (
          <div className="settings-server-card">
            <div className="settings-server-info">
              <span className="settings-server-name">{server.display_name}</span>
              <span className="settings-server-meta">{server.url} · {server.username}{server.alt_url ? ` · alt: ${server.alt_url}` : ""}</span>
            </div>
            <button className="settings-btn" onClick={beginEditServer}>Edit</button>
          </div>
        ) : server ? (
          <div className="settings-server-card">
            <div className="settings-server-info">
              <span className="settings-server-name">{server.display_name}</span>
              <span className="settings-server-meta">{server.url} · {server.username}{server.alt_url ? ` · alt: ${server.alt_url}` : ""}</span>
              <p className="settings-error">Stored credential is missing or unreadable. Re-enter your password or API key to reconnect.</p>
            </div>
            <button className="settings-btn primary" onClick={beginEditServer}>Reconnect</button>
          </div>
        ) : (
          <div className="settings-server-card">
            <div className="settings-server-info">
              <span className="settings-server-name">No server configured</span>
            </div>
            <button className="settings-btn primary" onClick={beginEditServer}>Add server</button>
          </div>
        )
      ) : (
        <div className="settings-server-edit">
          <label className="settings-field">
            <span>Server URL</span>
            <input
              type="url"
              value={editUrl}
              onChange={(e) => handleEditCredentialChange("url", e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Alternate URL <span style={{ fontWeight: "normal", opacity: 0.6 }}>(optional, used as fallback if primary is unreachable)</span></span>
            <input
              type="url"
              value={editAltUrl}
              placeholder="e.g. https://music.yourserver.com"
              onChange={(e) => handleEditCredentialChange("altUrl", e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Display name</span>
            <input
              type="text"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Username</span>
            <input
              type="text"
              autoComplete="username"
              value={editUsername}
              onChange={(e) => handleEditCredentialChange("username", e.target.value)}
            />
          </label>
          <div className="wizard-auth-method">
            <button
              type="button"
              className={`wizard-auth-tab${editAuthMethod === "password" ? " wizard-auth-tab--active" : ""}`}
              onClick={() => handleEditAuthMethodChange("password")}
            >Password</button>
            <button
              type="button"
              className={`wizard-auth-tab${editAuthMethod === "apikey" ? " wizard-auth-tab--active" : ""}`}
              onClick={() => handleEditAuthMethodChange("apikey")}
            >API Key</button>
          </div>
          {editAuthMethod === "password" ? (
            <label className="settings-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter password to re-test"
                value={editPassword}
                onChange={(e) => handleEditCredentialChange("password", e.target.value)}
              />
            </label>
          ) : (
            <label className="settings-field">
              <span>API Key</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Your Navidrome API key"
                value={editApiKey}
                onChange={(e) => handleEditCredentialChange("apiKey", e.target.value)}
              />
            </label>
          )}
          {serverTestState === "error" && <p className="settings-error">{serverTestError}</p>}
          {serverTestState === "ok" && serverSnapshotMatch && <p className="settings-success">Connection successful.</p>}
          {serverSaveError && <p className="settings-error">{serverSaveError}</p>}
          <div className="settings-field--row">
            <button className="settings-btn" onClick={() => setServerEditing(false)}>Cancel</button>
            <button
              className="settings-btn"
              onClick={() => { void handleServerTest(); }}
              disabled={!canTestServer || serverTestState === "testing"}
            >
              {serverTestState === "testing" ? "Testing…" : "Test connection"}
            </button>
            <button
              className="settings-btn primary"
              onClick={() => { void handleSaveServer(); }}
              disabled={!canSaveServer}
            >
              {serverSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {server && (
        <div className="settings-remove-server">
          {!removeConfirm ? (
            <button className="settings-btn settings-btn--danger" onClick={() => setRemoveConfirm(true)}>
              Remove server
            </button>
          ) : (
            <div className="settings-remove-confirm">
              <span className="settings-error">Remove server and return to setup?</span>
              <button className="settings-btn" onClick={() => setRemoveConfirm(false)}>Cancel</button>
              <button className="settings-btn settings-btn--danger" onClick={() => { void handleRemoveServer(); }}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
