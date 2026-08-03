import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAllTracksSessionStore } from "../store/allTracksSessionStore";
import { getDb } from "../db";

export interface AllTrackRow {
  id: string;
  title: string;
  artist: string | null;
  album_artist: string | null;
  album_id: string;
  album_name: string | null;
  album_artwork_url: string | null;
  genre: string | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  duration: number | null;
  play_count: number | null;
  bit_rate: number | null;
  suffix: string | null;
  replay_gain_track_gain: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_gain: number | null;
  replay_gain_album_peak: number | null;
}

// Rusqlite read path (psysonic pattern, see instructions/donow.md "rusqlite write/read
// split"). Mirrors useAlbums.ts/useArtists.ts/useTracks.ts - reads via
// src-tauri/src/library_read.rs's dedicated read-only connection instead of
// tauri-plugin-sql's sqlx pool. Ported after live measurement showed this hook's sqlx
// select taking 1.8-3.5s vs ~100-250ms for the already-piloted rusqlite reads.
// `enabled` lets the app root skip this fetch on routes that never render the track
// table. When false the effect returns early without clearing `data` - the session-store
// seed and last-loaded rows survive, so returning to the route paints instantly.
export function useAllTracks(enabled: boolean = true) {
  const refreshTick = useAllTracksSessionStore((s) => s.refreshTick);

  // Seed from the session-store cache synchronously so a view switch with unchanged
  // data paints the previous rows immediately - no loading flash, no re-invoke. This
  // hook's select is the heaviest (whole tracks table), so skipping it matters most.
  const [data, setData] = useState<AllTrackRow[] | undefined>(() => {
    const s = useAllTracksSessionStore.getState();
    return s.rows && s.cachedTick === s.refreshTick ? (s.rows as AllTrackRow[]) : undefined;
  });
  const [isLoading, setIsLoading] = useState(() => data === undefined);
  // A failed read leaves `data` undefined, which is indistinguishable from an empty
  // library. Callers need the difference to avoid rendering "no tracks" over a failure.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const s = useAllTracksSessionStore.getState();
    if (s.rows && s.cachedTick === refreshTick) {
      setData(s.rows as AllTrackRow[]);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<AllTrackRow[]>("get_all_tracks");
        if (!cancelled) {
          useAllTracksSessionStore.getState().setRows(rows, refreshTick);
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("useAllTracks: failed to load tracks", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, enabled]);

  return { data, isLoading, error };
}
