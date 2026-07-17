import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import { getDb } from "../db";
import type { AlbumRow, AlbumSort } from "../types/library";
export type { AlbumRow, AlbumSort } from "../types/library";

// Pilot for the tauri-plugin-sql -> rusqlite migration (psysonic pattern, see
// instructions/donow.md "rusqlite write/read split"). This read goes straight to a
// dedicated Rust read-only connection (src-tauri/src/library_read.rs) instead of
// round-tripping through tauri-plugin-sql's sqlx pool - no per-query IPC/sqlx overhead,
// and it can't contend with in-flight sync/enrichment writes. Writes/migrations for
// `albums` stay on tauri-plugin-sql for now; only this read path is piloted.
export function useAlbums(sort: AlbumSort = "artist", canonicalIds: string[] = []) {
  const refreshTick = useAlbumBrowseSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<AlbumRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const canonicalIdsKey = canonicalIds.join(",");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<AlbumRow[]>("get_albums", { sort, canonicalIds });
        if (!cancelled) {
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("useAlbums: failed to load albums", err);
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, canonicalIdsKey, refreshTick]);

  return { data, isLoading };
}
