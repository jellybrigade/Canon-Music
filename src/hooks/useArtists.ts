import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useArtistBrowseSessionStore } from "../store/artistBrowseSessionStore";
import { getDb } from "../db";
import type { ArtistRow } from "../types/library";
export type { ArtistRow } from "../types/library";

// Rusqlite read path (psysonic pattern, see instructions/donow.md "rusqlite write/read
// split"). Mirrors useAlbums.ts - reads via src-tauri/src/library_read.rs's dedicated
// read-only connection instead of tauri-plugin-sql's sqlx pool. Writes/migrations for
// `artists` stay on tauri-plugin-sql.
// `enabled` lets the app root skip this fetch on routes that never render an artist
// list. When false the effect returns early without clearing `data` - the session-store
// seed and last-loaded rows survive, so returning to the route paints instantly.
export function useArtists(enabled: boolean = true) {
  const refreshTick = useArtistBrowseSessionStore((s) => s.refreshTick);

  // Seed from the session-store cache synchronously so a view switch with unchanged
  // data paints the previous rows immediately - no loading flash, no re-invoke.
  const [data, setData] = useState<ArtistRow[] | undefined>(() => {
    const s = useArtistBrowseSessionStore.getState();
    return s.rows && s.cachedTick === s.refreshTick ? (s.rows as ArtistRow[]) : undefined;
  });
  const [isLoading, setIsLoading] = useState(() => data === undefined);
  // A failed read leaves `data` undefined, which is indistinguishable from an empty
  // library. Callers need the difference to avoid rendering "no artists, sync first" over
  // a failure the user cannot fix by syncing. Mirrors useAllTracks.ts.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const s = useArtistBrowseSessionStore.getState();
    if (s.rows && s.cachedTick === refreshTick) {
      setData(s.rows as ArtistRow[]);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<ArtistRow[]>("get_artists");
        if (!cancelled) {
          useArtistBrowseSessionStore.getState().setRows(rows, refreshTick);
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("useArtists: failed to load artists", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, enabled]);

  return { data, isLoading, error };
}
