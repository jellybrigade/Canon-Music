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
// `enabled` lets the app root skip this fetch on routes that never render an album
// list. When false the effect returns early without clearing `data` - the session-store
// seed and last-loaded rows survive, so returning to the route paints instantly.
export function useAlbums(
  sort: AlbumSort = "artist",
  canonicalIds: string[] = [],
  enabled: boolean = true
) {
  const refreshTick = useAlbumBrowseSessionStore((s) => s.refreshTick);
  const canonicalIdsKey = canonicalIds.join(",");
  const cacheKey = `${sort}|${canonicalIdsKey}`;

  // Seed from the session-store cache synchronously so a view switch with unchanged
  // data paints the previous rows immediately - no loading flash, no re-invoke.
  const [data, setData] = useState<AlbumRow[] | undefined>(() => {
    const s = useAlbumBrowseSessionStore.getState();
    return s.getRows(cacheKey, s.refreshTick) as AlbumRow[] | undefined;
  });
  const [isLoading, setIsLoading] = useState(() => data === undefined);

  useEffect(() => {
    if (!enabled) return;
    const cached = useAlbumBrowseSessionStore.getState().getRows(cacheKey, refreshTick);
    if (cached) {
      // Cache hit for this exact (sort, ids, tick) - use it, skip the query.
      setData(cached as AlbumRow[]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<AlbumRow[]>("get_albums", { sort, canonicalIds });
        if (!cancelled) {
          useAlbumBrowseSessionStore.getState().setRows(rows, refreshTick, cacheKey);
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
  }, [sort, canonicalIdsKey, refreshTick, enabled]);

  return { data, isLoading };
}
