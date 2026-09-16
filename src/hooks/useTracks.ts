import { useEffect, useState } from "react";
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
  // Keyed by the album it was read for, so the render that switches albums never reports the
  // previous album's rows (or its settled `isLoading: false`) under the new id: an effect in
  // the same commit would otherwise act on another album's tracks.
  const [result, setResult] = useState<{
    albumId: string;
    rows: TrackRow[] | undefined;
    // A failed read leaves `rows` undefined, which is indistinguishable from an album that
    // genuinely has no tracks yet. Callers need the difference to avoid rendering an empty
    // state that claims the album is empty when the read simply failed.
    error: string | null;
    isLoading: boolean;
  } | null>(null);

  useEffect(() => {
    if (albumId === null) return;
    let cancelled = false;
    setResult((prev) => ({
      albumId,
      rows: prev?.albumId === albumId ? prev.rows : undefined,
      error: null,
      isLoading: true,
    }));
    (async () => {
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<TrackRow[]>("get_tracks", { albumId });
        if (!cancelled) setResult({ albumId, rows, error: null, isLoading: false });
      } catch (err) {
        console.error("useTracks: failed to load tracks", err);
        if (!cancelled) {
          setResult({ albumId, rows: undefined, error: err instanceof Error ? err.message : String(err), isLoading: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [albumId, refreshTick]);

  const current = albumId !== null && result?.albumId === albumId ? result : null;
  return {
    data: current?.rows,
    isLoading: albumId !== null && (current?.isLoading ?? true),
    error: current?.error ?? null,
  };
}
