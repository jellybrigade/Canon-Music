import { getDb } from "../../../db";
import { REPLAY_GAIN_COLUMNS } from "../../../lib/replayGainRow";
import type { GenreSeedRow } from "./genreSeed";

/** One track drawn at random from the whole library, to seed a library shuffle. */
export async function loadRandomLibraryTrack(serverId: string): Promise<GenreSeedRow | null> {
  const db = await getDb();
  const rows = await db.select<GenreSeedRow[]>(
    `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name,
            ${REPLAY_GAIN_COLUMNS}
     FROM tracks t
     JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ?
     ORDER BY RANDOM()
     LIMIT 1`,
    [serverId],
  );
  return rows[0] ?? null;
}
