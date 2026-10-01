import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import { getDb } from "../db";
import type { AlbumRow, AlbumSort } from "../types/library";
export type { AlbumRow, AlbumSort } from "../types/library";

// Reads through the Rust read-only connection (library_read/albums.rs). `enabled: false`
// skips the fetch but keeps `data`, so returning to the route paints instantly.
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
    return s.getRows(cacheKey, s.refreshTick);
  });
  // The key the rows in `data` were read under. A tick refetch keeps its rows on screen, so
  // only a key with nothing read for it yet is loading; the old key's rows are not an answer.
  const [loadedKey, setLoadedKey] = useState<string | null>(() => (data === undefined ? null : cacheKey));
  // A failed read leaves `data` undefined, which is indistinguishable from an empty
  // library. Callers need the difference to avoid rendering "no albums" - or a "Loading…"
  // line that never resolves - over a failure. Mirrors useAllTracks.ts.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const cached = useAlbumBrowseSessionStore.getState().getRows(cacheKey, refreshTick);
    if (cached) {
      // Cache hit for this exact (sort, ids, tick) - use it, skip the query.
      setData(cached);
      setLoadedKey(cacheKey);
      setError(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<AlbumRow[]>("get_albums", { sort, canonicalIds });
        if (!cancelled) {
          useAlbumBrowseSessionStore.getState().setRows(rows, refreshTick, cacheKey);
          setData(rows);
          setLoadedKey(cacheKey);
        }
      } catch (err) {
        console.error("useAlbums: failed to load albums", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, canonicalIdsKey, refreshTick, enabled]);

  return { data, isLoading: loadedKey !== cacheKey && error === null, error };
}
