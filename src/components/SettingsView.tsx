import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, installAndRestart } from "../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { useSetting } from "../hooks/useSetting";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { autoIdentifyAlbum } from "../lib/album-identify";
import { persistAlbumIdentity } from "../hooks/useAlbumIdentity";
import { authenticate } from "../lib/navidrome";
import type { NavidromeCredential } from "../lib/navidrome";
import { getMinTagCount, setMinTagCount } from "../lib/lastfm";
import { getMinFolksonomyCount, setMinFolksonomyCount } from "../lib/musicbrainz";
import { keychain } from "../keychain";
import type { ServerWithCredential } from "../hooks/useServer";
import { useTagsStore } from "../store/tags";
import { usePlayerStore } from "../store/player";
import { useRapToHipHop } from "../hooks/useTagMappings";
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
  const [showWaveform, setShowWaveform] = useSetting("player.show_waveform", "false");
  const [restoreQueue, setRestoreQueue] = useSetting("queue.restore_on_startup", "false");
  const [playAction, setPlayAction] = useSetting("album.play_action", "replace");
  const speed = usePlayerStore((s) => s.speed);
  const consumeMode = usePlayerStore((s) => s.consumeMode);
  const toggleConsumeMode = usePlayerStore((s) => s.toggleConsumeMode);
  const consumeOnSkip = usePlayerStore((s) => s.consumeOnSkip);
  const toggleConsumeOnSkip = usePlayerStore((s) => s.toggleConsumeOnSkip);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const pauseFadeMs = usePlayerStore((s) => s.pauseFadeMs);
  const [, setPauseFadeSetting] = useSetting("player.pause_fade_ms", "150");
  const [stalenessDays, setStalenessDays] = useSetting("tags.staleness_days", "30");
  const [autoRefresh, setAutoRefresh] = useSetting("tags.auto_refresh", "true");
  const [mbAutoIdentify, setMbAutoIdentify] = useSetting("mb.auto_identify", "false");
  const { enabled: rapToHipHop, toggle: toggleRapToHipHop } = useRapToHipHop();
  const { data: minTagCount } = useQuery({
    queryKey: ["settings", "lastfm.min_tag_count"],
    queryFn: getMinTagCount,
  });
  const { data: minFolksonomyCount } = useQuery({
    queryKey: ["settings", "musicbrainz.min_folksonomy_count"],
    queryFn: getMinFolksonomyCount,
  });
  const pullProgress = useTagsStore((s) => s.pullProgress);
  const setPullProgress = useTagsStore((s) => s.setPullProgress);
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

  // Remove server confirm
  const [removeConfirm, setRemoveConfirm] = useState(false);

  // Settings filter
  const [settingsFilter, setSettingsFilter] = useState("");
  const fl = settingsFilter.toLowerCase().trim();
  function show(...labels: string[]) {
    return !fl || labels.some((l) => l.toLowerCase().includes(fl));
  }

  // Import ref
  const importInputRef = useRef<HTMLInputElement>(null);

  // About / update state
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateCheckState, setUpdateCheckState] = useState<"idle" | "checking" | "up-to-date" | "available" | "error">("idle");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  useEffect(() => { void getVersion().then(setAppVersion); }, []);

  const { server, credential } = serverWithCredential ?? {};

  // Unified "Refresh all" — MB identify unmatched, then Last.fm re-normalize all
  const handleRefreshAll = useCallback(async () => {
    const db = await getDb();
    type Row = { id: string; artist: string | null; name: string };

    // Step 1: MB identify unmatched albums
    const unmatched = await db.select<Row[]>(
      `SELECT a.id, a.artist, a.name FROM albums a
       WHERE NOT EXISTS (
         SELECT 1 FROM album_identity ai
         WHERE ai.album_id = a.id AND ai.confirmed_at IS NOT NULL
       )
       ORDER BY a.name`
    );
    if (unmatched.length > 0) {
      setPullProgress({ done: 0, total: unmatched.length });
      for (let i = 0; i < unmatched.length; i++) {
        const album = unmatched[i]!;
        try {
          const result = await autoIdentifyAlbum({ artist: album.artist ?? "", album: album.name });
          if (result.decision === "auto_confirmed" && result.detail) {
            const now = Math.floor(Date.now() / 1000);
            await persistAlbumIdentity({
              albumId: album.id,
              mbReleaseGroupId: result.detail.id,
              mbReleaseId: result.release?.id ?? null,
              mbArtistId: result.detail.artistMbid ?? null,
              lastfmArtistName: null,
              lastfmAlbumName: null,
              lastfmMatchConfirmed: false,
              combinedGenres: result.combinedGenres,
              combinedTags: result.combinedTags,
              label: result.release?.label ?? null,
              country: result.release?.country ?? null,
              catalogNumber: result.release?.catalogNumber ?? null,
              barcode: result.release?.barcode ?? null,
              releaseDate: result.release?.date ?? result.detail.firstReleaseDate ?? null,
              autoMatched: true,
              matchScore: Math.round(result.score * 100),
              confirmedAt: now,
            });
          } else {
            const now = Math.floor(Date.now() / 1000);
            await db.execute(
              `INSERT OR IGNORE INTO album_identity (album_id, auto_matched, match_score, looked_up_at)
               VALUES (?, 0, ?, ?)`,
              [album.id, Math.round(result.score * 100), now]
            );
          }
        } catch (e) {
          console.warn("MB sync failed for:", album.name, e);
        }
        setPullProgress({ done: i + 1, total: unmatched.length });
      }
      await queryClient.invalidateQueries({ queryKey: ["album-identity"] });
    }

    // Step 2: Last.fm normalize all albums (using identity strings when available)
    type FullRow = {
      id: string; artist: string | null; name: string;
      lastfm_artist_name: string | null; lastfm_album_name: string | null;
      combined_genres_json: string | null; combined_tags_json: string | null;
    };
    const albums = await db.select<FullRow[]>(
      `SELECT a.id, a.artist, a.name,
              ai.lastfm_artist_name, ai.lastfm_album_name, ai.combined_genres_json, ai.combined_tags_json
       FROM albums a
       LEFT JOIN album_identity ai ON ai.album_id = a.id
       ORDER BY a.name`
    );
    setPullProgress({ done: 0, total: albums.length });
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]!;
      try {
        const combinedMbGenres = album.combined_genres_json
          ? (JSON.parse(album.combined_genres_json) as Array<{ name: string; count: number }>)
          : null;
        const combinedMbTags = album.combined_tags_json
          ? (JSON.parse(album.combined_tags_json) as Array<{ name: string; count: number }>)
          : null;
        await normalizeAlbum(album.id, album.artist ?? "", album.name, {
          lastfmArtistName: album.lastfm_artist_name,
          lastfmAlbumName: album.lastfm_album_name,
          combinedMbGenres,
          combinedMbTags,
        });
      } catch (e) {
        console.warn("Last.fm sync failed for:", album.name, e);
      }
      setPullProgress({ done: i + 1, total: albums.length });
    }

    await queryClient.invalidateQueries({ queryKey: ["normalized-tags"] });
    void refetchLastRefreshed();
    setPullProgress(null);
  }, [refetchLastRefreshed, queryClient, setPullProgress]);

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

  async function handleExportSettings() {
    const db = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings");
    const json = JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.value])), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canon-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportSettings(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const db = await getDb();
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      window.location.reload();
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="settings-view">
      <div className="settings-inner">
        <h2 className="settings-title">Settings</h2>

        <div className="settings-search-wrap">
          <input
            className="settings-search-input"
            type="search"
            placeholder="Filter settings…"
            value={settingsFilter}
            onChange={(e) => setSettingsFilter(e.target.value)}
          />
        </div>

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

        {/* ── Metadata & Tags ── */}
        {show("metadata", "tags", "last.fm", "api key", "tag popularity", "musicbrainz", "auto-identify", "auto-refresh", "stale", "rap", "hip hop", "refresh all") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Metadata &amp; Tags</h3>
          <p className="settings-section-desc">
            Canon keeps tags clean and enriched automatically. Genres and artist metadata are pulled from
            Last.fm and MusicBrainz in the background. Nothing is written to your files.
          </p>

          <label className="settings-field">
            <span>Last.fm API key</span>
            <input
              type="text"
              placeholder="Paste your Last.fm API key"
              value={lastfmKey}
              onChange={(e) => void setLastfmKey(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Min tag popularity (0–100)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={minTagCount ?? 25}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 0 && v <= 100) {
                  void setMinTagCount(v).then(() => {
                    void queryClient.invalidateQueries({ queryKey: ["settings", "lastfm.min_tag_count"] });
                  });
                }
              }}
              className="settings-staleness-input"
            />
          </label>

          <p className="settings-section-desc" style={{ marginTop: "0.25rem" }}>
            <strong>MusicBrainz</strong> — no API key required. Use the{" "}
            <strong>Identify…</strong> button on any album or artist to confirm MusicBrainz IDs.
            Confirmed identity enriches genres, label, country, and release date.
          </p>
          <label className="settings-field">
            <span>Min folksonomy tag votes (0–100)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={minFolksonomyCount ?? 2}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 0 && v <= 100) {
                  void setMinFolksonomyCount(v).then(() => {
                    void queryClient.invalidateQueries({ queryKey: ["settings", "musicbrainz.min_folksonomy_count"] });
                  });
                }
              }}
              className="settings-staleness-input"
            />
          </label>
          <label className="settings-field settings-field--inline">
            <input
              type="checkbox"
              checked={mbAutoIdentify === "true"}
              onChange={(e) => void setMbAutoIdentify(e.target.checked ? "true" : "false")}
            />
            <span>Auto-identify albums when opened</span>
          </label>

          <label className="settings-field settings-field--inline" style={{ marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={autoRefresh === "true"}
              onChange={(e) => void setAutoRefresh(e.target.checked ? "true" : "false")}
            />
            <span>Auto-refresh metadata on launch</span>
          </label>
          <label className="settings-field">
            <span>Stale after (days)</span>
            <input
              type="number"
              min={1}
              max={9999}
              value={stalenessDays}
              onChange={(e) => void setStalenessDays(e.target.value)}
              className="settings-staleness-input"
            />
          </label>
          <label className="settings-field settings-field--inline">
            <input
              type="checkbox"
              checked={rapToHipHop}
              onChange={(e) => { void toggleRapToHipHop.mutate(e.target.checked); }}
            />
            <span>Map &ldquo;Rap&rdquo; to Hip Hop</span>
          </label>

          <div className="settings-field settings-field--row" style={{ marginTop: "0.25rem" }}>
            <button
              className="settings-btn"
              onClick={() => { void handleRefreshAll(); }}
              disabled={pullProgress !== null}
              title="Identify unmatched albums on MusicBrainz, then re-pull all Last.fm tags"
            >
              {pullProgress
                ? `Refreshing… ${pullProgress.done} / ${pullProgress.total}`
                : "Refresh all now"}
            </button>
            {lastRefreshedAt && pullProgress === null && (
              <span className="settings-hint">
                Last refreshed {new Date(lastRefreshedAt * 1000).toLocaleDateString()}
              </span>
            )}
          </div>
        </section>

        )}

        {/* ── Playback ── */}
        {show("playback", "waveform", "play album", "restore queue") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Playback</h3>
          <label className="settings-field settings-field--inline">
            <input
              type="checkbox"
              checked={showWaveform === "true"}
              onChange={(e) => void setShowWaveform(e.target.checked ? "true" : "false")}
            />
            <span>Show waveform progress bar</span>
          </label>
          <p className="settings-section-desc">
            Displays audio amplitude envelope in the progress bar. Extracted on first play and cached locally.
          </p>
          <label className="settings-field settings-field--inline" style={{ marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={restoreQueue === "true"}
              onChange={(e) => void setRestoreQueue(e.target.checked ? "true" : "false")}
            />
            <span>Restore queue on startup</span>
          </label>
          <p className="settings-section-desc">
            Restores your last queue and position when Canon starts. Playback does not resume automatically.
          </p>
          <label className="settings-field">
            <span>Play album action</span>
            <select
              value={playAction}
              onChange={(e) => void setPlayAction(e.target.value)}
              className="settings-select"
            >
              <option value="replace">Replace queue</option>
              <option value="queue_next">Play next</option>
              <option value="queue_last">Add to end</option>
              <option value="shuffle">Shuffle &amp; play</option>
            </select>
          </label>
          <p className="settings-section-desc">
            What clicking ▶ Play Album does to the current queue.
          </p>
          <label className="settings-field" style={{ marginTop: "0.5rem" }}>
            <span>Playback speed — {speed.toFixed(2)}×</span>
            <input
              type="range"
              className="settings-range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speed}
              onChange={(e) => void setSpeed(parseFloat(e.target.value))}
            />
          </label>
          <p className="settings-section-desc">
            Speed up or slow down playback. Affects pitch (no time-stretch).
          </p>
          <label className="settings-field settings-field--inline" style={{ marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={consumeMode}
              onChange={() => void toggleConsumeMode()}
            />
            <span>Consume mode</span>
          </label>
          <label className="settings-field settings-field--inline" style={{ marginTop: "0.25rem" }}>
            <input
              type="checkbox"
              checked={consumeOnSkip}
              disabled={!consumeMode}
              onChange={() => void toggleConsumeOnSkip()}
            />
            <span style={{ opacity: consumeMode ? 1 : 0.4 }}>Also consume on manual skip</span>
          </label>
          <p className="settings-section-desc">
            Remove each track from the queue after it finishes playing. Disabled in shuffle mode.
          </p>
          <label className="settings-field" style={{ marginTop: "0.5rem" }}>
            <span>Pause/resume fade — {pauseFadeMs === 0 ? "off" : `${pauseFadeMs} ms`}</span>
            <input
              type="range"
              className="settings-range"
              min={0}
              max={2000}
              step={50}
              value={pauseFadeMs}
              onChange={(e) => {
                const ms = parseInt(e.target.value, 10);
                usePlayerStore.setState({ pauseFadeMs: ms });
                void setPauseFadeSetting(String(ms));
              }}
            />
          </label>
          <p className="settings-section-desc">
            Smooth volume fade when pausing and resuming. 0 = instant.
          </p>
        </section>

        )}

        {/* ── About ── */}
        {show("about", "version", "update", "check for updates") && (
        <section className="settings-section">
          <h3 className="settings-section-title">About</h3>
          <div className="settings-diag-row">
            <span className="settings-diag-label">Version</span>
            <span className="settings-diag-value">{appVersion ?? "…"}</span>
          </div>
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

        )}

        {/* ── Diagnostics ── */}
        {show("diagnostics", "sync", "scrobble", "export", "import") && (
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

          <div className="settings-field settings-field--row" style={{ marginTop: "0.75rem" }}>
            <button className="settings-btn" onClick={() => { void handleExportSettings(); }}>
              Export settings
            </button>
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
            <span className="settings-hint">Server credentials are not included.</span>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
