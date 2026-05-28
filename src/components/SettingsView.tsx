import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetting } from "../hooks/useSetting";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { authenticate } from "../lib/navidrome";
import type { NavidromeCredential } from "../lib/navidrome";
import { checkSidecarHealth } from "../lib/sidecar";
import { keychain } from "../keychain";
import type { ServerWithCredential } from "../hooks/useServer";
import "./SettingsView.css";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";
type TestState = "idle" | "testing" | "ok" | "error";

interface Props {
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncedAt: number | null;
  serverWithCredential: ServerWithCredential | undefined;
  onRemoveServer: () => void;
}

function useLastRefreshed() {
  return useQuery({
    queryKey: ["albums", "last-computed-at"],
    queryFn: async () => {
      const db = await getDb();
      type Row = { last_at: number | null };
      const rows = await db.select<Row[]>("SELECT MAX(computed_at) as last_at FROM albums");
      return rows[0]?.last_at ?? null;
    },
  });
}

function useScrobbleQueueCount() {
  return useQuery({
    queryKey: ["scrobble_queue", "count"],
    queryFn: async () => {
      const db = await getDb();
      type Row = { n: number };
      const rows = await db.select<Row[]>("SELECT COUNT(*) as n FROM scrobble_queue");
      return rows[0]?.n ?? 0;
    },
    refetchInterval: 5000,
  });
}

export function SettingsView({ syncStatus, syncError, lastSyncedAt, serverWithCredential, onRemoveServer }: Props) {
  const [lastfmKey, setLastfmKey] = useSetting("lastfm.api_key", "");
  const [stalenessDays, setStalenessDays] = useSetting("tags.staleness_days", "90");
  const [pullMode, setPullMode] = useSetting("tags.pull_mode_default", "review");
  const [autoRefresh, setAutoRefresh] = useSetting("tags.auto_refresh", "true");
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  const { data: lastRefreshedAt, refetch: refetchLastRefreshed } = useLastRefreshed();
  const { data: scrobbleCount, refetch: refetchScrobbleCount } = useScrobbleQueueCount();
  const queryClient = useQueryClient();

  // Server edit state
  const [serverEditing, setServerEditing] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [serverTestState, setServerTestState] = useState<TestState>("idle");
  const [serverTestError, setServerTestError] = useState("");
  const [serverTestedSnapshot, setServerTestedSnapshot] = useState<{ url: string; username: string; password: string } | null>(null);
  const [serverTestedCredential, setServerTestedCredential] = useState<NavidromeCredential | null>(null);
  const [serverSaving, setServerSaving] = useState(false);
  const [serverSaveError, setServerSaveError] = useState("");

  // Sidecar edit state
  const [sidecarEditing, setSidecarEditing] = useState(false);
  const [editSidecarUrl, setEditSidecarUrl] = useState("");
  const [editSidecarSecret, setEditSidecarSecret] = useState("");
  const [editSidecarPathFrom, setEditSidecarPathFrom] = useState("");
  const [editSidecarPathTo, setEditSidecarPathTo] = useState("");
  const [sidecarTestState, setSidecarTestState] = useState<TestState>("idle");
  const [sidecarTestError, setSidecarTestError] = useState("");
  const [sidecarSaving, setSidecarSaving] = useState(false);
  const [sidecarSaveError, setSidecarSaveError] = useState("");

  // Diagnostics sidecar ping
  const [sidecarPingState, setSidecarPingState] = useState<TestState>("idle");
  const [sidecarPingError, setSidecarPingError] = useState("");
  const [sidecarPingTime, setSidecarPingTime] = useState<number | null>(null);

  // Remove server confirm
  const [removeConfirm, setRemoveConfirm] = useState(false);

  const { server, credential } = serverWithCredential ?? {};

  const handleRefreshNow = useCallback(async () => {
    const db = await getDb();
    type Row = { id: string; artist: string | null; name: string };
    const albums = await db.select<Row[]>("SELECT id, artist, name FROM albums ORDER BY name");
    setRefreshProgress({ done: 0, total: albums.length });
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]!;
      try {
        await normalizeAlbum(album.id, album.artist ?? "", album.name);
      } catch (e) {
        console.warn("Refresh failed for:", album.name, e);
      }
      setRefreshProgress({ done: i + 1, total: albums.length });
    }
    await queryClient.invalidateQueries({ queryKey: ["normalized-tags"] });
    void refetchLastRefreshed();
    setRefreshProgress(null);
  }, [refetchLastRefreshed, queryClient]);

  function beginEditServer() {
    if (!server) return;
    setEditUrl(server.url);
    setEditDisplayName(server.display_name);
    setEditUsername(server.username);
    setEditPassword("");
    setServerTestState("idle");
    setServerTestError("");
    setServerTestedSnapshot(null);
    setServerTestedCredential(null);
    setServerSaveError("");
    setServerEditing(true);
  }

  function handleEditCredentialChange(key: "url" | "username" | "password", v: string) {
    if (key === "url") setEditUrl(v);
    else if (key === "username") setEditUsername(v);
    else setEditPassword(v);
    setServerTestState("idle");
    setServerTestedSnapshot(null);
    setServerTestedCredential(null);
  }

  async function handleServerTest() {
    setServerTestState("testing");
    setServerTestError("");
    try {
      const cred = await authenticate(editUrl, editUsername, editPassword);
      setServerTestState("ok");
      setServerTestedSnapshot({ url: editUrl, username: editUsername, password: editPassword });
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
    serverTestedSnapshot.password === editPassword;

  const canSaveServer =
    serverTestState === "ok" &&
    serverSnapshotMatch &&
    editDisplayName.trim() !== "" &&
    !serverSaving;

  async function handleSaveServer() {
    if (!server || !serverTestedCredential) return;
    setServerSaving(true);
    setServerSaveError("");
    try {
      await keychain.set(`canon.server.${server.id}`, "credential", JSON.stringify(serverTestedCredential));
      const db = await getDb();
      await db.execute(
        "UPDATE servers SET url=?, display_name=?, username=? WHERE id=?",
        [editUrl.trim().replace(/\/+$/, ""), editDisplayName.trim(), editUsername.trim(), server.id]
      );
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      await queryClient.invalidateQueries({ queryKey: ["server-credential", server.id] });
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
    if (server.sidecar_secret_key) {
      try {
        await keychain.delete(server.sidecar_secret_key, "secret");
      } catch { /* not fatal */ }
    }
    onRemoveServer();
  }

  function beginEditSidecar() {
    if (!server) return;
    setEditSidecarUrl(server.sidecar_url ?? "");
    setEditSidecarSecret("");
    setEditSidecarPathFrom(server.sidecar_path_prefix_from ?? "");
    setEditSidecarPathTo(server.sidecar_path_prefix_to ?? "");
    setSidecarTestState("idle");
    setSidecarTestError("");
    setSidecarSaveError("");
    setSidecarEditing(true);
  }

  async function handleSidecarTest() {
    if (!editSidecarUrl.trim() || !editSidecarSecret.trim()) return;
    setSidecarTestState("testing");
    setSidecarTestError("");
    try {
      await checkSidecarHealth(editSidecarUrl.trim(), editSidecarSecret.trim());
      setSidecarTestState("ok");
    } catch (err) {
      setSidecarTestState("error");
      setSidecarTestError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveSidecar() {
    if (!server) return;
    setSidecarSaving(true);
    setSidecarSaveError("");
    try {
      const hasSidecar = editSidecarUrl.trim() !== "" && editSidecarSecret.trim() !== "";
      if (hasSidecar) {
        await keychain.set(`canon.sidecar.${server.id}`, "secret", editSidecarSecret.trim());
      } else if (server.sidecar_secret_key) {
        try { await keychain.delete(server.sidecar_secret_key, "secret"); } catch { /* ok */ }
      }
      const db = await getDb();
      await db.execute(
        "UPDATE servers SET sidecar_url=?, sidecar_secret_key=?, sidecar_path_prefix_from=?, sidecar_path_prefix_to=? WHERE id=?",
        [
          hasSidecar ? editSidecarUrl.trim() : null,
          hasSidecar ? `canon.sidecar.${server.id}` : null,
          editSidecarPathFrom.trim() || null,
          editSidecarPathTo.trim() || null,
          server.id,
        ]
      );
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      await queryClient.invalidateQueries({ queryKey: ["server-credential", server.id] });
      setSidecarEditing(false);
    } catch (err) {
      setSidecarSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSidecarSaving(false);
    }
  }

  async function handleRemoveSidecar() {
    if (!server) return;
    if (server.sidecar_secret_key) {
      try { await keychain.delete(server.sidecar_secret_key, "secret"); } catch { /* ok */ }
    }
    const db = await getDb();
    await db.execute(
      "UPDATE servers SET sidecar_url=NULL, sidecar_secret_key=NULL, sidecar_path_prefix_from=NULL, sidecar_path_prefix_to=NULL WHERE id=?",
      [server.id]
    );
    await queryClient.invalidateQueries({ queryKey: ["servers"] });
    await queryClient.invalidateQueries({ queryKey: ["server-credential", server.id] });
  }

  async function handleSidecarPing() {
    if (!server?.sidecar_url || !server.sidecar_secret_key) return;
    setSidecarPingState("testing");
    setSidecarPingError("");
    try {
      const secret = await keychain.get(server.sidecar_secret_key, "secret");
      await checkSidecarHealth(server.sidecar_url, secret);
      setSidecarPingState("ok");
      setSidecarPingTime(Date.now());
    } catch (err) {
      setSidecarPingState("error");
      setSidecarPingError(err instanceof Error ? err.message : String(err));
    }
  }

  function syncStatusLabel() {
    switch (syncStatus) {
      case "syncing": return "Syncing…";
      case "done": return lastSyncedAt ? `Done — ${new Date(lastSyncedAt).toLocaleTimeString()}` : "Done";
      case "partial": return `Partial — ${syncError}`;
      case "error": return `Error — ${syncError}`;
      default: return "Idle";
    }
  }

  void credential; // used indirectly via server ops

  return (
    <div className="settings-view">
      <h2 className="settings-title">Settings</h2>

      {/* ── Server ── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Server</h3>
        {server ? (
          <>
            {!serverEditing ? (
              <div className="settings-server-card">
                <div className="settings-server-info">
                  <span className="settings-server-name">{server.display_name}</span>
                  <span className="settings-server-meta">{server.url} · {server.username}</span>
                </div>
                <button className="settings-btn" onClick={beginEditServer}>Edit</button>
              </div>
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
                {serverTestState === "error" && <p className="settings-error">{serverTestError}</p>}
                {serverTestState === "ok" && serverSnapshotMatch && <p className="settings-success">Connection successful.</p>}
                {serverSaveError && <p className="settings-error">{serverSaveError}</p>}
                <div className="settings-field--row">
                  <button className="settings-btn" onClick={() => setServerEditing(false)}>Cancel</button>
                  <button
                    className="settings-btn"
                    onClick={() => { void handleServerTest(); }}
                    disabled={!editUrl.trim() || !editUsername.trim() || !editPassword.trim() || serverTestState === "testing"}
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

            {/* Sidecar subsection */}
            <div className="settings-sidecar">
              <div className="settings-sidecar-header">
                <span className="settings-section-desc" style={{ margin: 0 }}>
                  {server.sidecar_url ? `Sidecar: ${server.sidecar_url}` : "No sidecar configured — tag editing disabled"}
                </span>
                <div className="settings-sidecar-actions">
                  {server.sidecar_url && (
                    <button className="settings-btn" onClick={() => { void handleRemoveSidecar(); }}>Remove</button>
                  )}
                  <button className="settings-btn" onClick={beginEditSidecar}>
                    {server.sidecar_url ? "Edit" : "Set up sidecar"}
                  </button>
                </div>
              </div>

              {sidecarEditing && (
                <div className="settings-server-edit" style={{ marginTop: "0.75rem" }}>
                  <label className="settings-field">
                    <span>Sidecar URL</span>
                    <input
                      type="url"
                      placeholder="http://localhost:8765"
                      value={editSidecarUrl}
                      onChange={(e) => { setEditSidecarUrl(e.target.value); setSidecarTestState("idle"); }}
                    />
                  </label>
                  <label className="settings-field">
                    <span>Shared secret</span>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="Enter secret to re-test"
                      value={editSidecarSecret}
                      onChange={(e) => { setEditSidecarSecret(e.target.value); setSidecarTestState("idle"); }}
                    />
                  </label>
                  <label className="settings-field">
                    <span>Path remap: from</span>
                    <input
                      type="text"
                      placeholder="/mnt/music"
                      value={editSidecarPathFrom}
                      onChange={(e) => setEditSidecarPathFrom(e.target.value)}
                    />
                  </label>
                  <label className="settings-field">
                    <span>Path remap: to</span>
                    <input
                      type="text"
                      placeholder="/music"
                      value={editSidecarPathTo}
                      onChange={(e) => setEditSidecarPathTo(e.target.value)}
                    />
                  </label>
                  {sidecarTestState === "error" && <p className="settings-error">{sidecarTestError}</p>}
                  {sidecarTestState === "ok" && <p className="settings-success">Sidecar reachable.</p>}
                  {sidecarSaveError && <p className="settings-error">{sidecarSaveError}</p>}
                  <div className="settings-field--row">
                    <button className="settings-btn" onClick={() => setSidecarEditing(false)}>Cancel</button>
                    <button
                      className="settings-btn"
                      onClick={() => { void handleSidecarTest(); }}
                      disabled={!editSidecarUrl.trim() || !editSidecarSecret.trim() || sidecarTestState === "testing"}
                    >
                      {sidecarTestState === "testing" ? "Testing…" : "Test sidecar"}
                    </button>
                    <button
                      className="settings-btn primary"
                      onClick={() => { void handleSaveSidecar(); }}
                      disabled={sidecarSaving}
                    >
                      {sidecarSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Remove server */}
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
          </>
        ) : (
          <p className="settings-section-desc">No server configured.</p>
        )}
      </section>

      {/* ── Last.fm ── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Last.fm</h3>
        <label className="settings-field">
          <span>API Key</span>
          <input
            type="text"
            placeholder="Paste your Last.fm API key"
            value={lastfmKey}
            onChange={(e) => void setLastfmKey(e.target.value)}
          />
        </label>
      </section>

      {/* ── Tags ── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Tags</h3>
        <label className="settings-field">
          <span>Staleness threshold (days)</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={stalenessDays}
            onChange={(e) => void setStalenessDays(e.target.value)}
            className="settings-staleness-input"
          />
        </label>
        <div className="settings-field">
          <span>Default pull mode</span>
          <div className="settings-radio-group">
            <label>
              <input
                type="radio"
                name="pull_mode"
                value="review"
                checked={pullMode === "review"}
                onChange={() => void setPullMode("review")}
              />
              Review in Inbox
            </label>
            <label>
              <input
                type="radio"
                name="pull_mode"
                value="silent"
                checked={pullMode === "silent"}
                onChange={() => void setPullMode("silent")}
              />
              Silent
            </label>
          </div>
        </div>
      </section>

      {/* ── Tag automation ── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Tag automation</h3>
        <label className="settings-field settings-field--inline">
          <input
            type="checkbox"
            checked={autoRefresh === "true"}
            onChange={(e) => void setAutoRefresh(e.target.checked ? "true" : "false")}
          />
          <span>Auto-refresh tags on launch</span>
        </label>
        <div className="settings-field settings-field--row">
          <button
            className="settings-btn"
            onClick={() => { void handleRefreshNow(); }}
            disabled={refreshProgress !== null}
          >
            {refreshProgress
              ? `Refreshing… ${refreshProgress.done} / ${refreshProgress.total}`
              : "Refresh now"}
          </button>
          {lastRefreshedAt && refreshProgress === null && (
            <span className="settings-hint">
              Last refreshed {new Date(lastRefreshedAt * 1000).toLocaleDateString()}
            </span>
          )}
        </div>
      </section>

      {/* ── Diagnostics ── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Diagnostics</h3>

        <div className="settings-diag-row">
          <span className="settings-diag-label">Sync</span>
          <span className={`settings-diag-value${syncStatus === "error" || syncStatus === "partial" ? " settings-diag-value--error" : ""}`}>
            {syncStatusLabel()}
          </span>
        </div>

        <div className="settings-diag-row">
          <span className="settings-diag-label">Scrobble queue</span>
          <span className="settings-diag-value">
            {scrobbleCount ?? "—"} pending
          </span>
          <button
            className="settings-btn"
            onClick={() => { void refetchScrobbleCount(); }}
          >
            Refresh
          </button>
        </div>

        {server?.sidecar_url && (
          <div className="settings-diag-row">
            <span className="settings-diag-label">Sidecar</span>
            <span className={`settings-diag-value${sidecarPingState === "error" ? " settings-diag-value--error" : sidecarPingState === "ok" ? " settings-diag-value--ok" : ""}`}>
              {sidecarPingState === "idle" && "—"}
              {sidecarPingState === "testing" && "Checking…"}
              {sidecarPingState === "ok" && `Reachable${sidecarPingTime ? ` · ${new Date(sidecarPingTime).toLocaleTimeString()}` : ""}`}
              {sidecarPingState === "error" && `Unreachable — ${sidecarPingError}`}
            </span>
            <button
              className="settings-btn"
              onClick={() => { void handleSidecarPing(); }}
              disabled={sidecarPingState === "testing"}
            >
              Check
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
