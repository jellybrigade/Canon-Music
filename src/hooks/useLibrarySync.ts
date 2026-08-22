import { useRef, useState, useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { syncLibrary } from "../lib/sync";
import type { SyncProgress } from "../lib/sync";
import { invalidateGenreTreeCache } from "./useGenreTree";
import { useSetting } from "./useSetting";
import type { Server } from "../types/server";
import { QK } from "../lib/query-keys";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import { useArtistBrowseSessionStore } from "../store/artistBrowseSessionStore";
import { useLovedSessionStore } from "../store/lovedSessionStore";
import { useGenresSessionStore } from "../store/genresSessionStore";
import { useAllTracksSessionStore } from "../store/allTracksSessionStore";
import { usePlaylistSessionStore } from "../store/playlistSessionStore";

export type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";

// A failed run cannot stay claimed: with the auto-sync interval off nothing else
// would ever retry it, so a server that was down at launch stays unsynced until
// the user presses sync or restarts. Clearing the claim in the settle handler
// instead would restart the run immediately and hammer an unreachable server, so
// the retry is delayed and bounded - past the last delay the manual sync button
// and a server switch are the only ways back, which is what the interval-off
// setting asks for.
const RETRY_DELAYS_MS = [30_000, 120_000, 300_000];

export function useLibrarySync(server: Server | undefined, queryClient: QueryClient) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string>("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const syncingRef = useRef(false);
  const syncedRef = useRef<string | null>(null);
  // Lets the settle handler below see which server is selected now, not which
  // one this run started for.
  const serverRef = useRef<Server | undefined>(server);
  serverRef.current = server;
  const [autoSyncIntervalMin] = useSetting("library.auto_sync_interval_min", "5");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<{ id: string; attempts: number } | null>(null);

  function clearRetryTimer() {
    if (retryTimerRef.current === null) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }

  function scheduleRetry(s: Server) {
    const attempts = retryRef.current?.id === s.id ? retryRef.current.attempts : 0;
    const delay = RETRY_DELAYS_MS[attempts];
    if (delay === undefined) return;
    retryRef.current = { id: s.id, attempts: attempts + 1 };
    clearRetryTimer();
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      const latest = serverRef.current;
      if (!latest || latest.id !== s.id) return;
      // The claim is the only thing stopping this server being synced again, so
      // it has to go before syncIfNeeded can do anything.
      if (syncedRef.current === s.id) syncedRef.current = null;
      syncIfNeeded(latest);
    }, delay);
  }

  /** Returns whether a run actually started. */
  function runSync(s: Server): boolean {
    if (syncingRef.current) return false;
    syncingRef.current = true;
    clearRetryTimer();
    let failed = false;
    setSyncStatus("syncing");
    setSyncError("");
    setSyncProgress(null);
    // No bump here: nothing has been written yet at sync start, so bumping would
    // only force a full re-read of the album table for identical data. The
    // progress callback below bumps once rows actually land.
    //
    // Progress fires every BATCH_NOTIFY_INTERVAL albums, which on a large library
    // can be several times a second, debounce so mid-sync UI (e.g. HomeView's
    // For You rail) isn't reshuffling multiple times a second.
    let lastInvalidate = 0;
    syncLibrary(s, (progress) => {
      // Progress state is cheap to set and is the only thing telling the user a
      // long first sync is moving rather than hung, so it updates every tick.
      // Only the store bump, which forces a full album re-read, is debounced.
      setSyncProgress(progress);
      const now = Date.now();
      if (now - lastInvalidate < 1500) return;
      lastInvalidate = now;
      useAlbumBrowseSessionStore.getState().bumpRefresh();
    })
      .then(({ failedAlbums, failedPlaylists, skippedStages, albumTracksIncomplete, changed }) => {
        const hasPartialFailure =
          failedAlbums > 0 || failedPlaylists > 0 || skippedStages.length > 0 || albumTracksIncomplete;
        setSyncStatus(hasPartialFailure ? "partial" : "done");
        setLastSyncedAt(Date.now());
        if (retryRef.current?.id === s.id) retryRef.current = null;
        if (hasPartialFailure) {
          const messages = [];
          const parts = [];
          if (failedAlbums > 0) parts.push(`${failedAlbums} album${failedAlbums > 1 ? "s" : ""}`);
          if (failedPlaylists > 0) parts.push(`${failedPlaylists} playlist${failedPlaylists > 1 ? "s" : ""}`);
          if (parts.length > 0) messages.push(`failed to fetch tracks for ${parts.join(" and ")}`);
          // Skipped stages kept their stored data, so say so rather than implying data loss.
          if (skippedStages.length > 0) messages.push(`${skippedStages.join(" and ")} unchanged (server unreachable)`);
          // The album pass is different: it stopped part way, so those albums were
          // not read at all and cannot be described as unchanged.
          if (albumTracksIncomplete) {
            messages.push("stopped reading album tracks early (server unreachable), the rest follow next sync");
          }
          setSyncError(`Sync partial: ${messages.join("; ")}.`);
        }
        // Each bump invalidates a session-store snapshot and forces a full
        // re-read of that table, so only bump what this sync actually wrote.
        // An idle auto-sync (nothing changed server-side) now bumps nothing.
        const libraryChanged = changed.albums || changed.tracks;
        if (libraryChanged) {
          useAlbumBrowseSessionStore.getState().bumpRefresh();
          invalidateGenreTreeCache();
        }
        setTimeout(() => {
          if (changed.artists) useArtistBrowseSessionStore.getState().bumpRefresh();
          if (libraryChanged) {
            useGenresSessionStore.getState().bumpRefresh();
            useAllTracksSessionStore.getState().bumpRefresh();
          }
        }, 300);
        setTimeout(() => {
          if (changed.loved) useLovedSessionStore.getState().bumpRefresh();
          if (changed.playlists) {
            // changed.playlists covers ordered track ids too, and the sync
            // DELETEs + re-INSERTs playlist_tracks, so both ticks must move or
            // an open playlist keeps showing stale track order.
            usePlaylistSessionStore.getState().bumpPlaylists();
            usePlaylistSessionStore.getState().bumpPlaylistTracks();
          }
        }, 600);
        if (libraryChanged) {
          setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: QK.tagIssues() });
          }, 1000);
        }
      })
      .catch((err: unknown) => {
        failed = true;
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
        console.error("Sync failed:", err);
      })
      .finally(() => {
        syncingRef.current = false;
        setSyncProgress(null);
        // The user may have switched servers while this run was in flight, in
        // which case the effect below could not start one for the new server.
        const latest = serverRef.current;
        if (!latest) return;
        // A failure leaves the server claimed, so syncIfNeeded would do nothing
        // here; the backoff is what gets it retried. A server switched to while
        // this run was failing is a different server and syncs straight away.
        if (failed && latest.id === s.id) {
          scheduleRetry(s);
          return;
        }
        syncIfNeeded(latest);
      });
    return true;
  }

  // Claims the server as synced only once a run actually starts. Stamping first
  // and calling runSync second lost the sync entirely when one was already in
  // flight: runSync is a no-op then, but the server counted as done and nothing
  // retried until the next auto-sync tick, or never when the interval is off.
  function syncIfNeeded(s: Server) {
    if (syncedRef.current === s.id) return;
    if (runSync(s)) syncedRef.current = s.id;
  }

  useEffect(() => {
    if (!server) return;
    syncIfNeeded(server);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  // Only touches refs, so the identity it captures on mount behaves like any later one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => clearRetryTimer, []);

  useEffect(() => {
    const intervalMin = parseInt(autoSyncIntervalMin, 10);
    if (!server || isNaN(intervalMin) || intervalMin <= 0) return;
    const id = setInterval(() => { runSync(server); }, intervalMin * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, autoSyncIntervalMin]);

  return { syncStatus, syncError, syncProgress, lastSyncedAt, runSync };
}
