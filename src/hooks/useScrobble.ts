import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/player";

const SCROBBLE_MIN_ELAPSED_S = 240;
const SCROBBLE_FRACTION = 0.5;

export function useScrobble(track: CurrentTrack | null, elapsed: number) {
  const scrobbedRef = useRef(false);
  const playStartedAt = usePlayerStore((s) => s.playStartedAt);

  useEffect(() => {
    scrobbedRef.current = false;
  }, [playStartedAt]);

  useEffect(() => {
    if (!track || scrobbedRef.current) return;

    const duration = track.duration ?? null;
    const thresholdMet =
      elapsed >= SCROBBLE_MIN_ELAPSED_S ||
      (duration !== null && duration > 0 && elapsed / duration >= SCROBBLE_FRACTION);

    if (!thresholdMet) return;

    scrobbedRef.current = true;
    const timestamp = Math.floor(Date.now() / 1000);

    getDb()
      .then((db) =>
        db.execute(
          "INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES (?, ?, ?, ?)",
          [track.id, track.title, track.artist ?? "", timestamp]
        )
      )
      .catch((e) => console.error("Failed to write scrobble_queue:", e));
  }, [track, elapsed]);
}
