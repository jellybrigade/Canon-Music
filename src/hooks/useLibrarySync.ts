import { useRef, useState, useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { syncLibrary } from "../lib/sync";
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

export function useLibrarySync(server: Server | undefined, queryClient: QueryClient) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string>("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const syncingRef = useRef(false);
  const syncedRef = useRef<string | null>(null);
  const [autoSyncIntervalMin] = useSetting("library.auto_sync_interval_min", "5");

  function runSync(s: Server) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncStatus("syncing");
    setSyncError("");
    // No bump here: nothing has been written yet at sync start, so bumping would
    // only force a full re-read of the album table for identical data. The
    // progress callback below bumps once rows actually land.
    //
    // Progress fires every BATCH_NOTIFY_INTERVAL albums, which on a large library
    // can be several times a second, debounce so mid-sync UI (e.g. HomeView's
    // For You rail) isn't reshuffling multiple times a second.
    let lastInvalidate = 0;
    syncLibrary(s, () => {
      const now = Date.now();
      if (now - lastInvalidate < 1500) return;
      lastInvalidate = now;
      useAlbumBrowseSessionStore.getState().bumpRefresh();
    })
      .then(({ failedAlbums, failedPlaylists, changed }) => {
        const hasPartialFailure = failedAlbums > 0 || failedPlaylists > 0;
        setSyncStatus(hasPartialFailure ? "partial" : "done");
        setLastSyncedAt(Date.now());
        if (hasPartialFailure) {
          const parts = [];
          if (failedAlbums > 0) parts.push(`${failedAlbums} album${failedAlbums > 1 ? "s" : ""}`);
          if (failedPlaylists > 0) parts.push(`${failedPlaylists} playlist${failedPlaylists > 1 ? "s" : ""}`);
          setSyncError(`Sync partial: failed to fetch tracks for ${parts.join(" and ")}.`);
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
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
        console.error("Sync failed:", err);
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }

  useEffect(() => {
    if (!server || syncedRef.current === server.id) return;
    syncedRef.current = server.id;
    runSync(server);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  useEffect(() => {
    const intervalMin = parseInt(autoSyncIntervalMin, 10);
    if (!server || isNaN(intervalMin) || intervalMin <= 0) return;
    const id = setInterval(() => { runSync(server); }, intervalMin * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, autoSyncIntervalMin]);

  return { syncStatus, syncError, lastSyncedAt, runSync };
}
