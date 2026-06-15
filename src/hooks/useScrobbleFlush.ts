import { useEffect } from "react";
import { getDb } from "../db";
import { scrobbleTrack } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import type { ServerWithCredential } from "./useServer";

const FLUSH_INTERVAL_MS = 60_000;

export function useScrobbleFlush(serverWithCred: ServerWithCredential | undefined) {
  useEffect(() => {
    if (!serverWithCred) return;

    const { server, credential } = serverWithCred;

    async function flush() {
      try {
        const db = await getDb();
        type ScrobbleRow = { id: number; track_id: string; timestamp: number };
        const rows = await db.select<ScrobbleRow[]>(
          "SELECT id, track_id, timestamp FROM scrobble_queue ORDER BY timestamp"
        );

        for (const row of rows) {
          if (!row.track_id.startsWith(server.id + ":")) continue;
          try {
            const nativeId = stripServerPrefix(row.track_id, server.id);
            await scrobbleTrack(server.url, server.username, credential, nativeId, row.timestamp * 1000);
            await db.execute(
              "INSERT OR IGNORE INTO scrobble_history (track_id, timestamp) VALUES (?, ?)",
              [row.track_id, row.timestamp]
            );
            await db.execute("DELETE FROM scrobble_queue WHERE id = ?", [row.id]);
          } catch {
            break; // Server unreachable — stop batch
          }
        }
      } catch (e) {
        console.error("useScrobbleFlush: flush error:", e);
      }
    }

    void flush();
    const interval = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    window.addEventListener("online", flush);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", flush);
    };
  }, [serverWithCred]);
}
