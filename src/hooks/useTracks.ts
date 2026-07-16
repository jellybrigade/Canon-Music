import { useEffect, useRef, useState } from "react";
import { getDb } from "../db";
import { useTrackListSessionStore } from "../store/trackListSessionStore";
import type { TrackRow } from "../types/library";
export type { TrackRow } from "../types/library";

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
        const db = await getDb();
        const rows = await db.select<TrackRow[]>(
          `SELECT id, title, artist, album_artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count, bit_rate, suffix, file_size, replay_gain_track_gain, replay_gain_track_peak, replay_gain_album_gain, replay_gain_album_peak
           FROM tracks
           WHERE album_id = ?
           ORDER BY disc_number, track_number`,
          [albumId]
        );
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
