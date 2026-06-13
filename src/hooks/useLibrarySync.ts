import { useRef, useState, useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { syncLibrary } from "../lib/sync";
import { invalidateGenreTreeCache } from "./useGenreTree";
import type { Server } from "../types/server";
import { QK } from "../lib/query-keys";

export type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";

export function useLibrarySync(server: Server | undefined, queryClient: QueryClient) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string>("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const syncingRef = useRef(false);
  const syncedRef = useRef<string | null>(null);

  function runSync(s: Server) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncStatus("syncing");
    setSyncError("");
    void queryClient.invalidateQueries({ queryKey: QK.albumsAll() });
    syncLibrary(s, () => {
      void queryClient.invalidateQueries({ queryKey: QK.albumsAll() });
    })
      .then(({ failedAlbums, failedPlaylists }) => {
        const hasPartialFailure = failedAlbums > 0 || failedPlaylists > 0;
        setSyncStatus(hasPartialFailure ? "partial" : "done");
        setLastSyncedAt(Date.now());
        if (hasPartialFailure) {
          const parts = [];
          if (failedAlbums > 0) parts.push(`${failedAlbums} album${failedAlbums > 1 ? "s" : ""}`);
          if (failedPlaylists > 0) parts.push(`${failedPlaylists} playlist${failedPlaylists > 1 ? "s" : ""}`);
          setSyncError(`Sync partial — failed to fetch tracks for ${parts.join(" and ")}.`);
        }
        void queryClient.invalidateQueries({ queryKey: QK.albumsAll() });
        invalidateGenreTreeCache();
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: QK.artists() });
          void queryClient.invalidateQueries({ queryKey: QK.genres() });
        }, 300);
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: QK.loved_tracks() });
          void queryClient.invalidateQueries({ queryKey: QK.loved_albums() });
          void queryClient.invalidateQueries({ queryKey: QK.playlists() });
        }, 600);
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: QK.tagIssues() });
        }, 1000);
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
    if (!server) return;
    const id = setInterval(() => { runSync(server); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  return { syncStatus, syncError, lastSyncedAt, runSync };
}
