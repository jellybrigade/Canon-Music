import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "../db";
import { errorMessage } from "../lib/errorMessage";
import { useGenresSessionStore } from "../store/genresSessionStore";

export interface GenreRow {
  canonical_id: string;
  name: string;
  album_count: number;
}

// Rusqlite read path (psysonic pattern), mirroring useAlbums/useArtists/useAllTracks;
// caches rows on the session store keyed by tick so repeat mounts reuse one fetch.

// Only shows direct (leaf) canon-tree genres, raw: ids excluded. `enabled` lets the
// app root skip the fetch on routes that never render the filter sidebar; when false
// the last-loaded rows are kept, only the fetch is skipped.
export function useGenres(enabled: boolean = true) {
  const refreshTick = useGenresSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<GenreRow[] | undefined>(() => {
    const s = useGenresSessionStore.getState();
    return s.rows && s.cachedTick === s.refreshTick ? (s.rows as GenreRow[]) : undefined;
  });
  const [isFetching, setIsFetching] = useState(() => data === undefined);
  // A failed read leaves `data` undefined, which callers would otherwise render as "no genres".
  const [error, setError] = useState<string | null>(null);
  // Re-runs this read alone; a store tick bump would refetch every genre read with it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const s = useGenresSessionStore.getState();
    if (s.rows && s.cachedTick === refreshTick) {
      setData(s.rows as GenreRow[]);
      setIsFetching(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    setError(null);
    (async () => {
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<GenreRow[]>("get_genres");
        if (!cancelled) {
          useGenresSessionStore.getState().setRows(rows, refreshTick);
          setData(rows);
          setIsFetching(false);
        }
      } catch (err) {
        console.error("useGenres: failed to load genres", err);
        if (!cancelled) {
          setError(errorMessage(err));
          setIsFetching(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // A tick refetch keeps its rows on screen, so only a read with nothing to show is loading.
  return { data, isLoading: isFetching && data === undefined, error, retry };
}

// Genres drawn from the user's most recently played albums (up to 10 albums).
// Falls back to top genres by album_count when no scrobble history exists - that
// fallback branch lives in the Rust command now.
export function useRecentGenres() {
  const refreshTick = useGenresSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<GenreRow[] | undefined>(() => {
    const s = useGenresSessionStore.getState();
    return s.recentRows && s.recentCachedTick === s.refreshTick ? (s.recentRows as GenreRow[]) : undefined;
  });
  const [isFetching, setIsFetching] = useState(() => data === undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const s = useGenresSessionStore.getState();
    if (s.recentRows && s.recentCachedTick === refreshTick) {
      setData(s.recentRows as GenreRow[]);
      setIsFetching(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    setError(null);
    (async () => {
      try {
        await getDb();
        const rows = await invoke<GenreRow[]>("get_recent_genres");
        if (!cancelled) {
          useGenresSessionStore.getState().setRecentRows(rows, refreshTick);
          setData(rows);
          setIsFetching(false);
        }
      } catch (err) {
        console.error("useRecentGenres: failed to load genres", err);
        if (!cancelled) {
          setError(errorMessage(err));
          setIsFetching(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const genres = useMemo(() => data ?? [], [data]);
  // A tick refetch keeps its rows on screen, so only a read with nothing to show is loading.
  return { data, isLoading: isFetching && data === undefined, error, retry, genres };
}
