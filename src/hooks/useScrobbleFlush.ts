import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { scrobbleTrack, SubsonicError } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import { QK } from "../lib/query-keys";
import type { ServerWithCredential } from "./useServer";

const FLUSH_INTERVAL_MS = 60_000;

/**
 * Subsonic error 70 is "the requested data was not found". A scrobble for a track
 * the server has deleted answers with it every single time, so retrying the row is
 * pointless and, because the batch stops at the first failure, it would wall off
 * every scrobble queued behind it. Nothing else is treated as permanent: an auth
 * failure (40/41/50) in particular must not be allowed to delete the user's
 * offline backlog, since re-entering the password makes those rows sendable again.
 */
const PERMANENT_SUBSONIC_CODES = new Set([70]);

export function useScrobbleFlush(serverWithCred: ServerWithCredential | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!serverWithCred) return;

    const { server, credential } = serverWithCred;
    // A scrobble is non-idempotent, so it gets one 12s attempt per route: a handful of
    // queued rows against a slow server can outlast FLUSH_INTERVAL_MS. Without this the
    // next tick (or the "online" listener) would re-SELECT rows the running flush has
    // not deleted yet and send them a second time, which the server counts twice.
    let flushing = false;
    let cancelled = false;

    async function flush() {
      if (flushing || cancelled) return;
      flushing = true;
      let sent = 0;
      try {
        const db = await getDb();
        type ScrobbleRow = { id: number; track_id: string; timestamp: number };
        const rows = await db.select<ScrobbleRow[]>(
          "SELECT id, track_id, timestamp FROM scrobble_queue ORDER BY timestamp"
        );

        for (const row of rows) {
          if (cancelled) break;
          if (!row.track_id.startsWith(server.id + ":")) continue;
          try {
            const nativeId = stripServerPrefix(row.track_id, server.id);
            await scrobbleTrack(server.url, server.username, credential, nativeId, row.timestamp * 1000, server.alt_url ?? undefined);
          } catch (e) {
            if (e instanceof SubsonicError && e.code !== null && PERMANENT_SUBSONIC_CODES.has(e.code)) {
              // Drop it and keep going, otherwise this row blocks the queue forever.
              console.warn(`useScrobbleFlush: dropping unsendable scrobble for ${row.track_id}:`, e.message);
              await db.execute("DELETE FROM scrobble_queue WHERE id = ?", [row.id]);
              continue;
            }
            break; // Server unreachable or refusing for a reason that may clear, stop batch
          }
          await db.execute(
            "INSERT OR IGNORE INTO scrobble_history (track_id, timestamp) VALUES (?, ?)",
            [row.track_id, row.timestamp]
          );
          await db.execute("DELETE FROM scrobble_queue WHERE id = ?", [row.id]);
          // The server has the play now, but nothing brings the number back: the sync's
          // track fetch is skipped for any album whose created/songCount are unchanged,
          // so tracks.play_count would stay frozen at whatever the first sync captured.
          // Count it locally instead. Deliberately after the DELETE, so a crash in this
          // window loses a count rather than double-counting it, and a later track fetch
          // overwrites with the server's value, which by then already includes this play.
          await db.execute(
            "UPDATE tracks SET play_count = play_count + 1 WHERE id = ?",
            [row.track_id]
          );
          await db.execute(
            "UPDATE albums SET play_count = play_count + 1 WHERE id = (SELECT album_id FROM tracks WHERE id = ?)",
            [row.track_id]
          );
          sent++;
        }
      } catch (e) {
        console.error("useScrobbleFlush: flush error:", e);
      } finally {
        flushing = false;
      }

      if (sent > 0 && !cancelled) {
        void queryClient.invalidateQueries({ queryKey: QK.albumsListeningStats() });
        void queryClient.invalidateQueries({ queryKey: QK.albumsPartiallyHeard() });
        void queryClient.invalidateQueries({ queryKey: QK.scrobbleQueueCount() });
      }
    }

    void flush();
    const interval = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, [serverWithCred, queryClient]);
}
