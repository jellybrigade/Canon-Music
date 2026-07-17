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
export function useArtists() {
  const refreshTick = useArtistBrowseSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<ArtistRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<ArtistRow[]>("get_artists");
        if (!cancelled) {
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("useArtists: failed to load artists", err);
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return { data, isLoading };
}
