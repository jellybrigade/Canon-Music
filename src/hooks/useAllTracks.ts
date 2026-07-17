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
export function useAllTracks() {
  const refreshTick = useAllTracksSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<AllTrackRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<AllTrackRow[]>("get_all_tracks");
        if (!cancelled) {
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("useAllTracks: failed to load tracks", err);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return { data, isLoading };
}
