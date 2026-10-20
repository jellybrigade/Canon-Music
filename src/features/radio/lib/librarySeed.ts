import { getDb } from "../../../db";
import { REPLAY_GAIN_COLUMNS } from "../../../lib/replayGainRow";
import type { GenreSeedRow } from "./genreSeed";

/**
 * One track drawn at random from the whole library, to seed a library shuffle. Picked by
 * position from a count: `ORDER BY RANDOM()` sorts every track on the server per draw.
 */
export async function loadRandomLibraryTrack(serverId: string): Promise<GenreSeedRow | null> {
  const db = await getDb();
  const counted = await db.select<{ total: number }[]>(
    "SELECT COUNT(*) AS total FROM tracks t JOIN albums a ON t.album_id = a.id WHERE t.server_id = ?",
    [serverId],
  );
  const total = counted[0]?.total ?? 0;
  if (total === 0) return null;
  const rows = await db.select<GenreSeedRow[]>(
    `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name,
            ${REPLAY_GAIN_COLUMNS}
     FROM tracks t
     JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ?
     ORDER BY t.id
     LIMIT 1 OFFSET ?`,
    [serverId, Math.floor(Math.random() * total)],
  );
  return rows[0] ?? null;
}
