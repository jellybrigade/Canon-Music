import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../db";
import { QK } from "../../lib/query-keys";
import { getMissingCoverCount, useCacheAllCovers } from "../../hooks/useCoverCache";
import type { ServerWithCredential } from "../../hooks/useServer";
import { exportSettingsFile, importSettingsFile } from "../../lib/settings-backup";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";

interface Props {
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncedAt: number | null;
  searchQuery: string;
  serverWithCredential: ServerWithCredential | undefined;
}

// Rough per-cover size for a 300px JPEG thumbnail; used only to show a ballpark estimate.
const MIN_COVER_KB = 25;
const MAX_COVER_KB = 70;

function formatSizeRange(count: number): string {
  const minMb = (count * MIN_COVER_KB) / 1024;
  const maxMb = (count * MAX_COVER_KB) / 1024;
  if (maxMb < 1) return `${Math.round(count * MIN_COVER_KB)}–${Math.round(count * MAX_COVER_KB)} KB`;
  return `${minMb.toFixed(1)}–${maxMb.toFixed(1)} MB`;
}

function useMissingCoverCount() {
  return useQuery({
    queryKey: QK.albumCoversMissingCount(),
    queryFn: getMissingCoverCount,
  });
}

function useScrobbleQueueCount() {
  return useQuery({
    queryKey: QK.scrobbleQueueCount(),
    queryFn: async () => {
      const db = await getDb();
      type Row = { n: number };
      const rows = await db.select<Row[]>("SELECT COUNT(*) as n FROM scrobble_queue");
      return rows[0]?.n ?? 0;
    },
    refetchInterval: 5000,
  });
}

export function DiagnosticsTab({ syncStatus, syncError, lastSyncedAt, searchQuery, serverWithCredential }: Props) {
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const { data: scrobbleCount, refetch: refetchScrobbleCount } = useScrobbleQueueCount();
  const { data: missingCoverCount, refetch: refetchMissingCoverCount } = useMissingCoverCount();
  const { run: cacheAllCovers, progress: coverProgress, lastFailedCount } = useCacheAllCovers(serverWithCredential);

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some(l => l.toLowerCase().includes(fl));

  function syncStatusLabel() {
    switch (syncStatus) {
      case "syncing": return "Syncing…";
      case "done": return lastSyncedAt ? `Done — ${new Date(lastSyncedAt).toLocaleTimeString()}` : "Done";
      case "partial": return `Partial — ${syncError}`;
      case "error": return `Error — ${syncError}`;
      default: return "Idle";
    }
  }

  async function handleImportSettings(file: File) {
    try {
      await importSettingsFile(file);
      await queryClient.invalidateQueries({ queryKey: QK.settingsAll() });
      window.location.reload();
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <>
      {show("sync", "library", "diagnostics") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Sync</h3>
          <div className="settings-diag-row">
            <span className="settings-diag-label">Library sync</span>
            <span className={`settings-diag-value${syncStatus === "error" || syncStatus === "partial" ? " settings-diag-value--error" : ""}`}>
              {syncStatusLabel()}
            </span>
          </div>
        </section>
      )}

      {show("scrobble", "queue", "diagnostics") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Scrobble queue</h3>
          <div className="settings-diag-row">
            <span className="settings-diag-label">Pending</span>
            <span className="settings-diag-value">{scrobbleCount ?? "—"}</span>
            <button className="settings-btn" onClick={() => { void refetchScrobbleCount(); }}>
              Refresh
            </button>
          </div>
        </section>
      )}

      {show("cover", "art", "cache", "artwork", "thumbnail") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Album cover cache</h3>
          <p className="settings-section-desc">
            Canon caches cover art locally the first time each album loads. Use this to pre-cache
            everything at once, e.g. after a fresh sync.
          </p>
          <div className="settings-field settings-field--row">
            <button
              className="settings-btn"
              disabled={!serverWithCredential || coverProgress !== null || !missingCoverCount}
              onClick={() => {
                void cacheAllCovers().then(() => { void refetchMissingCoverCount(); });
              }}
            >
              {coverProgress
                ? `Caching… ${coverProgress.done} / ${coverProgress.total}`
                : "Cache all covers now"}
            </button>
            {coverProgress === null && (
              <span className="settings-hint">
                {missingCoverCount
                  ? `${missingCoverCount} album${missingCoverCount === 1 ? "" : "s"} not yet cached (~${formatSizeRange(missingCoverCount)})`
                  : "All covers cached"}
              </span>
            )}
            {coverProgress === null && !!lastFailedCount && (
              <span className="settings-hint settings-diag-value--error">
                {lastFailedCount} failed to cache last run — check server connection (see console for details)
              </span>
            )}
          </div>
        </section>
      )}

      {show("export", "import", "settings", "backup") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Settings backup</h3>
          <p className="settings-section-desc">Server credentials are not included in exports.</p>
          <div className="settings-field settings-field--row">
            <button className="settings-btn" onClick={() => { void exportSettingsFile(); }}>
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
          </div>
        </section>
      )}
    </>
  );
}
