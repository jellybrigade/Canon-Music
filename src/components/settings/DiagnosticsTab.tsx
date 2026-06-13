import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../db";
import { QK } from "../../lib/query-keys";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";

interface Props {
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncedAt: number | null;
  searchQuery: string;
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

export function DiagnosticsTab({ syncStatus, syncError, lastSyncedAt, searchQuery }: Props) {
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const { data: scrobbleCount, refetch: refetchScrobbleCount } = useScrobbleQueueCount();

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

      {show("export", "import", "settings", "backup") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Settings backup</h3>
          <p className="settings-section-desc">Server credentials are not included in exports.</p>
          <div className="settings-field settings-field--row">
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
          </div>
        </section>
      )}
    </>
  );
}
