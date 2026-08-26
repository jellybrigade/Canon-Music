import { useRef, useState, useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { syncLibrary } from "../lib/sync";
import type { SyncProgress } from "../lib/sync";
import { invalidateGenreTreeCache } from "./useGenreTree";
import { useSetting } from "./useSetting";
import type { ServerWithCredential } from "./useServer";
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

/** "a", "a and b", "a, b and c". A plain join reads as a chain past two items. */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function useLibrarySync(target: ServerWithCredential | undefined, queryClient: QueryClient) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string>("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  // When the bounded backoff below will fire, so the failure banner can count it
  // down instead of reading as a permanent fault. Null once the backoff is spent.
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const syncingRef = useRef(false);
  const syncedRef = useRef<string | null>(null);
  // Lets the settle handler below see which server is selected now, not which
  // one this run started for.
  const serverRef = useRef<ServerWithCredential | undefined>(target);
  serverRef.current = target;
  const [autoSyncIntervalMin] = useSetting("library.auto_sync_interval_min", "5");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<{ id: string; attempts: number } | null>(null);
  // Nothing aborts an in-flight syncLibrary, so its settle handler can land after
  // the hook is gone. Everything the handler does then is either dead or wrong.
  const mountedRef = useRef(true);
  const fanoutTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearRetryTimer() {
    if (retryTimerRef.current === null) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }

  function scheduleFanout(step: () => void, delay: number) {
    fanoutTimersRef.current.push(setTimeout(step, delay));
  }

  function clearFanoutTimers() {
    for (const id of fanoutTimersRef.current) clearTimeout(id);
    fanoutTimersRef.current = [];
  }

  function scheduleRetry(s: ServerWithCredential) {
    const id = s.server.id;
    const attempts = retryRef.current?.id === id ? retryRef.current.attempts : 0;
    const delay = RETRY_DELAYS_MS[attempts];
    if (delay === undefined) {
      setNextRetryAt(null);
      return;
    }
    retryRef.current = { id, attempts: attempts + 1 };
    clearRetryTimer();
    setNextRetryAt(Date.now() + delay);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      // The stamp is spent whether or not this retry goes on to start a run: the
      // bail-outs below leave nothing to count down to.
      setNextRetryAt(null);
      const latest = serverRef.current;
      if (!latest || latest.server.id !== id) return;
      // The claim is the only thing stopping this server being synced again, so
      // it has to go before syncIfNeeded can do anything.
      if (syncedRef.current === id) syncedRef.current = null;
      syncIfNeeded(latest);
    }, delay);
  }

  /** Returns whether a run actually started. */
  function runSync(s: ServerWithCredential): boolean {
    if (syncingRef.current) return false;
    syncingRef.current = true;
    clearRetryTimer();
    let failed = false;
    setSyncStatus("syncing");
    setSyncError("");
    setSyncProgress(null);
    setNextRetryAt(null);
    // No bump here: nothing has been written yet at sync start, so bumping would
    // only force a full re-read of the album table for identical data. The
    // progress callback below bumps once rows actually land.
    //
    // Progress fires every BATCH_NOTIFY_INTERVAL albums, which on a large library
    // can be several times a second, debounce so mid-sync UI (e.g. HomeView's
    // For You rail) isn't reshuffling multiple times a second.
    let lastInvalidate = 0;
    syncLibrary(s.server, s.credential, (progress) => {
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
        if (!mountedRef.current) return;
        const hasPartialFailure =
          failedAlbums > 0 || failedPlaylists > 0 || skippedStages.length > 0 || albumTracksIncomplete;
        setSyncStatus(hasPartialFailure ? "partial" : "done");
        setLastSyncedAt(Date.now());
        if (retryRef.current?.id === s.server.id) retryRef.current = null;
        if (hasPartialFailure) {
          const messages = [];
          const parts = [];
          if (failedAlbums > 0) parts.push(`${failedAlbums} album${failedAlbums > 1 ? "s" : ""}`);
          if (failedPlaylists > 0) parts.push(`${failedPlaylists} playlist${failedPlaylists > 1 ? "s" : ""}`);
          if (parts.length > 0) messages.push(`failed to fetch tracks for ${listPhrase(parts)}`);
          // Skipped stages kept their stored data, so say so rather than implying data loss.
          if (skippedStages.length > 0) messages.push(`${listPhrase(skippedStages)} unchanged (server unreachable)`);
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
        scheduleFanout(() => {
          if (changed.artists) useArtistBrowseSessionStore.getState().bumpRefresh();
          if (libraryChanged) {
            useGenresSessionStore.getState().bumpRefresh();
            useAllTracksSessionStore.getState().bumpRefresh();
          }
        }, 300);
        scheduleFanout(() => {
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
          scheduleFanout(() => {
            void queryClient.invalidateQueries({ queryKey: QK.tagIssues() });
          }, 1000);
        }
      })
      .catch((err: unknown) => {
        failed = true;
        console.error("Sync failed:", err);
        if (!mountedRef.current) return;
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        syncingRef.current = false;
        setSyncProgress(null);
        // The user may have switched servers while this run was in flight, in
        // which case the effect below could not start one for the new server.
        const latest = serverRef.current;
        if (!latest) return;
        // A failure leaves the server claimed, so syncIfNeeded would do nothing
        // here; the backoff is what gets it retried. A server switched to while
        // this run was failing is a different server and syncs straight away.
        if (failed && latest.server.id === s.server.id) {
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
  function syncIfNeeded(s: ServerWithCredential) {
    if (syncedRef.current === s.server.id) return;
    if (runSync(s)) syncedRef.current = s.server.id;
  }

  useEffect(() => {
    if (!target) return;
    syncIfNeeded(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Only touches refs, so the identity it captures on mount behaves like any later one.
  // The flag is re-armed in the body because StrictMode's mount/unmount/mount would
  // otherwise leave every later run's settle handler permanently disarmed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      clearFanoutTimers();
    };
  }, []);

  useEffect(() => {
    const intervalMin = parseInt(autoSyncIntervalMin, 10);
    if (!target || isNaN(intervalMin) || intervalMin <= 0) return;
    // Keyed on the id, not the object: `App.tsx` derives the server from a query result, so an
    // equal-but-new object arrives on any refetch or remount, and re-arming on each one would
    // reset the countdown before a tick could land. The tick reads the live server for the
    // same reason it cannot depend on it.
    const id = setInterval(() => {
      const latest = serverRef.current;
      if (latest) runSync(latest);
    }, intervalMin * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.server.id, autoSyncIntervalMin]);

  return { syncStatus, syncError, syncProgress, lastSyncedAt, nextRetryAt, runSync };
}
