import { useEffect, useState } from "react";
import { getDb } from "../../db";
import type { ResumePoint } from "./playlistResume";

// Keyed by playlist: the route does not remount the page when the playlist changes, and a
// reset written in an effect would hand the next playlist this one's row for a commit.
export function usePlaylistResumePoint(playlistId: string): ResumePoint | null {
  const [loaded, setLoaded] = useState<{ playlistId: string; point: ResumePoint } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDb()
      .then(async (db) => {
        type Row = { last_track_id: string; track_position: number };
        const rows = await db.select<Row[]>(
          "SELECT last_track_id, track_position FROM playlist_resume WHERE playlist_id = ?",
          [playlistId],
        );
        const row = rows[0];
        if (!cancelled && row) {
          setLoaded({ playlistId, point: { lastTrackId: row.last_track_id, trackPosition: row.track_position } });
        }
      })
      .catch((e) => console.error("Failed to read playlist resume position:", e));
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  return loaded?.playlistId === playlistId ? loaded.point : null;
}
