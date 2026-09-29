import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { scrobbleTrack } from "../../../clients/navidrome";
import { SubsonicError } from "../../../clients/navidromeTransport";
import { stripServerPrefix } from "../../../lib/ids";
import { escapeLike } from "../../../lib/sql";
import { QK } from "../../../lib/queryKeys";
import type { ServerWithCredential } from "../../../hooks/useServer";

const FLUSH_INTERVAL_MS = 60_000;

// Only "not found" is permanent; auth failures must keep the offline backlog.
const PERMANENT_SUBSONIC_CODES = new Set([70]);

/** Rows are owned by the server whose id prefixes their `track_id`; scope the read in SQL, not the loop. */
function ownerPattern(serverId: string): string {
  return `${escapeLike(serverId)}:%`;
}

/** Servers with a flush pass running. Module-scoped: a per-effect guard would let a
 * credential refetch's new pass re-SELECT an undeleted row and send it twice. */
const serversFlushing = new Set<string>();

/** Queued rows the currently selected server could send, i.e. what a backlog count may claim. */
export async function getScrobbleQueueCount(serverId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) as n FROM scrobble_queue WHERE track_id LIKE ? ESCAPE '\\'",
    [ownerPattern(serverId)]
  );
  return rows[0]?.n ?? 0;
}

export function useScrobbleFlush(serverWithCred: ServerWithCredential | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!serverWithCred) return;

    const { server, credential } = serverWithCred;
    // Scrobbles are non-idempotent; without the in-flight claim a slow flush
    // outlasting FLUSH_INTERVAL_MS would get re-selected and sent twice.
    let cancelled = false;

    async function flush() {
      if (serversFlushing.has(server.id) || cancelled) return;
      serversFlushing.add(server.id);
      let sent = 0;
      try {
        const db = await getDb();
        type ScrobbleRow = { id: number; track_id: string; timestamp: number };
        const rows = await db.select<ScrobbleRow[]>(
          "SELECT id, track_id, timestamp FROM scrobble_queue WHERE track_id LIKE ? ESCAPE '\\' ORDER BY timestamp",
          [ownerPattern(server.id)]
        );

        for (const row of rows) {
          if (cancelled) break;
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
          // Sync's play_count skip-fast-path won't catch this play; count it locally.
          // After the DELETE so a crash loses a count instead of double-counting it.
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
        serversFlushing.delete(server.id);
      }

      if (sent > 0 && !cancelled) {
        void queryClient.invalidateQueries({ queryKey: QK.albumsListeningStats() });
        void queryClient.invalidateQueries({ queryKey: QK.albumsPartiallyHeard() });
        void queryClient.invalidateQueries({ queryKey: QK.scrobbleQueueCount(server.id) });
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
