import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTrackListSessionStore } from "../store/trackListSessionStore";
import { getDb } from "../db";
import type { TrackRow } from "../types/library";
export type { TrackRow } from "../types/library";

// Rusqlite read path (psysonic pattern, see instructions/donow.md "rusqlite write/read
// split"). Mirrors useAlbums.ts/useArtists.ts - reads via src-tauri/src/library_read.rs's
// dedicated read-only connection instead of tauri-plugin-sql's sqlx pool.
export function useTracks(albumId: string | null) {
  const refreshTick = useTrackListSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<TrackRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(albumId !== null);
  const prevAlbumIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (albumId === null) {
      setData(undefined);
      setIsLoading(false);
      prevAlbumIdRef.current = null;
      return;
    }
    if (prevAlbumIdRef.current !== albumId) {
      setData(undefined);
    }
    prevAlbumIdRef.current = albumId;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<TrackRow[]>("get_tracks", { albumId });
        if (!cancelled) {
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("useTracks: failed to load tracks", err);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [albumId, refreshTick]);

  return { data, isLoading };
}
