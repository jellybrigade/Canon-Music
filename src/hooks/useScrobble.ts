import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/player";
import { reportNowPlaying } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import type { ServerWithCredential } from "./useServer";
import { useSetting } from "./useSetting";

// A rejected insert clears the stamp so the next position poll retries, which makes the
// poll the retry clock: unbounded, a database that stays locked would write five failing
// statements a second for the rest of the track.
const MAX_QUEUE_WRITE_ATTEMPTS = 3;

export function useScrobble(
  track: CurrentTrack | null,
  serverWithCred: ServerWithCredential | undefined
) {
  const scrobbedRef = useRef(false);
  const writeAttemptsRef = useRef(0);
  // One timestamp per play, so a retry can ask whether the row it failed to confirm is there.
  const timestampRef = useRef<number | null>(null);
  const playStartedAt = usePlayerStore((s) => s.playStartedAt);
  const elapsed = usePlayerStore((s) => s.elapsed);
  const [minSecondsRaw] = useSetting("scrobble.min_seconds", "240");
  const [thresholdPctRaw] = useSetting("scrobble.threshold_percent", "50");
  const minElapsedS = Math.max(0, parseInt(minSecondsRaw, 10) || 0);
  const fraction = Math.max(0, Math.min(100, parseInt(thresholdPctRaw, 10) || 50)) / 100;

  useEffect(() => {
    scrobbedRef.current = false;
    writeAttemptsRef.current = 0;
    timestampRef.current = null;
  }, [playStartedAt]);

  useEffect(() => {
    if (!track || !serverWithCred) return;
    const { server, credential } = serverWithCred;
    if (!track.id.startsWith(server.id + ":")) return;
    const nativeId = stripServerPrefix(track.id, server.id);
    reportNowPlaying(server.url, server.username, credential, nativeId, server.alt_url ?? undefined).catch(
      () => {} // server unreachable, silently skip
    );
  }, [playStartedAt, track, serverWithCred]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!track || scrobbedRef.current) return;

    const duration = track.duration ?? null;
    const thresholdMet =
      elapsed >= minElapsedS ||
      (duration !== null && duration > 0 && elapsed / duration >= fraction);

    if (!thresholdMet) return;

    scrobbedRef.current = true;
    writeAttemptsRef.current += 1;
    const timestamp = timestampRef.current ?? Math.floor(Date.now() / 1000);
    timestampRef.current = timestamp;
    const trackId = track.id;

    getDb()
      .then((db) =>
        db.execute(
          "INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES (?, ?, ?, ?)",
          [trackId, track.title, track.artist ?? "", timestamp]
        )
      )
      .catch(async (e) => {
        console.error("Failed to write scrobble_queue:", e);
        if (writeAttemptsRef.current >= MAX_QUEUE_WRITE_ATTEMPTS) return;
        // A rejection cannot say whether the insert committed, so ask. Re-arming blind
        // sends the same play to the server twice.
        try {
          const db = await getDb();
          const rows = await db.select<{ id: number }[]>(
            "SELECT id FROM scrobble_queue WHERE track_id = ? AND timestamp = ? LIMIT 1",
            [trackId, timestamp]
          );
          if (rows.length > 0) return;
        } catch {
          // Cannot confirm either way, so leave the play queued for the next launch
          // rather than risk a duplicate.
          return;
        }
        scrobbedRef.current = false;
      });
  }, [track, elapsed]);
}

/**
 * Isolates the 200ms `elapsed` store subscription in its own leaf component
 * so the 5x/second tick doesn't re-render the caller (App owns a large tree).
 */
export function ScrobbleTracker({
  track,
  serverWithCred,
}: {
  track: CurrentTrack | null;
  serverWithCred: ServerWithCredential | undefined;
}) {
  useScrobble(track, serverWithCred);
  return null;
}
