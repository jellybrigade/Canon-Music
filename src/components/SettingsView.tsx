import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSetting } from "../hooks/useSetting";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import "./SettingsView.css";

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

export function SettingsView() {
  const [lastfmKey, setLastfmKey] = useSetting("lastfm.api_key", "");
  const [stalenessDays, setStalenessDays] = useSetting("tags.staleness_days", "90");
  const [pullMode, setPullMode] = useSetting("tags.pull_mode_default", "review");
  const [autoRefresh, setAutoRefresh] = useSetting("tags.auto_refresh", "true");
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  const { data: lastRefreshedAt, refetch: refetchLastRefreshed } = useLastRefreshed();

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
    void refetchLastRefreshed();
    setRefreshProgress(null);
  }, [refetchLastRefreshed]);

  return (
    <div className="settings-view">
      <h2 className="settings-title">Settings</h2>

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

      <section className="settings-section">
        <h3 className="settings-section-title">Tag automation</h3>
        <label className="settings-field settings-field--inline">
          <input
            type="checkbox"
            checked={autoRefresh === "true"}
            onChange={(e) => void setAutoRefresh(e.target.checked ? "true" : "false")}
          />
          <span>Auto-refresh tags on launch (30-day staleness)</span>
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


    </div>
  );
}
