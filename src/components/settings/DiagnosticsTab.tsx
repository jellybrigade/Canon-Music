import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QK } from "../../lib/query-keys";
import { getMissingCoverCount, useCacheAllCovers } from "../../hooks/useCoverCache";
import { getMissingArtistImageCount, useCacheAllArtistImages } from "../../hooks/useArtistImageCache";
import { getScrobbleQueueCount } from "../../hooks/useScrobbleFlush";
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

function formatSizeRange(count: number, minKb: number, maxKb: number): string {
  const minMb = (count * minKb) / 1024;
  const maxMb = (count * maxKb) / 1024;
  if (maxMb < 1) return `${Math.round(count * minKb)} to ${Math.round(count * maxKb)} KB`;
  return `${minMb.toFixed(1)} to ${maxMb.toFixed(1)} MB`;
}

// Artist portraits come from Last.fm/Wikidata at whatever resolution they were uploaded at,
// so the range runs wider than the fixed-size 300px album covers.
const MIN_ARTIST_IMAGE_KB = 15;
const MAX_ARTIST_IMAGE_KB = 150;

function useMissingCoverCount() {
  return useQuery({
    queryKey: QK.albumCoversMissingCount(),
    queryFn: getMissingCoverCount,
  });
}

function useMissingArtistImageCount() {
  return useQuery({
    queryKey: QK.artistCoversMissingCount(),
    queryFn: getMissingArtistImageCount,
  });
}

function useScrobbleQueueCount(serverId: string | undefined) {
  return useQuery({
    queryKey: QK.scrobbleQueueCount(serverId),
    queryFn: () => getScrobbleQueueCount(serverId as string),
    enabled: !!serverId,
    refetchInterval: 5000,
  });
}

export function DiagnosticsTab({ syncStatus, syncError, lastSyncedAt, searchQuery, serverWithCredential }: Props) {
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const { data: scrobbleCount, refetch: refetchScrobbleCount } = useScrobbleQueueCount(serverWithCredential?.server.id);
  const { data: missingCoverCount, refetch: refetchMissingCoverCount } = useMissingCoverCount();
  const { run: cacheAllCovers, progress: coverProgress, lastFailedCount } = useCacheAllCovers(serverWithCredential);
  const { data: missingArtistImageCount, refetch: refetchMissingArtistImageCount } = useMissingArtistImageCount();
  const { run: cacheAllArtistImages, progress: artistImageProgress, lastFailedCount: lastFailedArtistImageCount } = useCacheAllArtistImages();

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some(l => l.toLowerCase().includes(fl));

  function syncStatusLabel() {
    switch (syncStatus) {
      case "syncing": return "Syncing…";
      case "done": return lastSyncedAt ? `Done (${new Date(lastSyncedAt).toLocaleTimeString()})` : "Done";
      case "partial": return `Partial: ${syncError}`;
      case "error": return `Error: ${syncError}`;
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
            <span className="settings-diag-value">{scrobbleCount ?? "-"}</span>
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
                  ? `${missingCoverCount} album${missingCoverCount === 1 ? "" : "s"} not yet cached (~${formatSizeRange(missingCoverCount, MIN_COVER_KB, MAX_COVER_KB)})`
                  : "All covers cached"}
              </span>
            )}
            {coverProgress === null && !!lastFailedCount && (
              <span className="settings-hint settings-diag-value--error">
                {lastFailedCount} failed to cache last run. Check server connection (see console for details)
              </span>
            )}
          </div>
        </section>
      )}

      {show("artist", "portrait", "cache", "artwork", "image") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Artist portrait cache</h3>
          <p className="settings-section-desc">
            Canon caches artist portraits locally the first time each artist loads. Use this to
            pre-cache everything at once, e.g. after enriching your library.
          </p>
          <div className="settings-field settings-field--row">
            <button
              className="settings-btn"
              disabled={artistImageProgress !== null || !missingArtistImageCount}
              onClick={() => {
                void cacheAllArtistImages().then(() => { void refetchMissingArtistImageCount(); });
              }}
            >
              {artistImageProgress
                ? `Caching… ${artistImageProgress.done} / ${artistImageProgress.total}`
                : "Cache all artist portraits now"}
            </button>
            {artistImageProgress === null && (
              <span className="settings-hint">
                {missingArtistImageCount
                  ? `${missingArtistImageCount} artist${missingArtistImageCount === 1 ? "" : "s"} not yet cached (~${formatSizeRange(missingArtistImageCount, MIN_ARTIST_IMAGE_KB, MAX_ARTIST_IMAGE_KB)})`
                  : "All artist portraits cached"}
              </span>
            )}
            {artistImageProgress === null && !!lastFailedArtistImageCount && (
              <span className="settings-hint settings-diag-value--error">
                {lastFailedArtistImageCount} failed to cache last run. Check console for details
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
