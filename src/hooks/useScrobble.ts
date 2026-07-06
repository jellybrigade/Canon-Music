import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/player";
import { reportNowPlaying } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import type { ServerWithCredential } from "./useServer";
import { useSetting } from "./useSetting";

export function useScrobble(
  track: CurrentTrack | null,
  serverWithCred: ServerWithCredential | undefined
) {
  const scrobbedRef = useRef(false);
  const playStartedAt = usePlayerStore((s) => s.playStartedAt);
  const elapsed = usePlayerStore((s) => s.elapsed);
  const [minSecondsRaw] = useSetting("scrobble.min_seconds", "240");
  const [thresholdPctRaw] = useSetting("scrobble.threshold_percent", "50");
  const minElapsedS = Math.max(0, parseInt(minSecondsRaw, 10) || 0);
  const fraction = Math.max(0, Math.min(100, parseInt(thresholdPctRaw, 10) || 50)) / 100;

  useEffect(() => {
    scrobbedRef.current = false;
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
