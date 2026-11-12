import { getDb } from "../../../db";
import { REPLAY_GAIN_COLUMNS } from "../../../lib/replayGainRow";
import type { PlayableTrackRow } from "../../../lib/track";

/**
 * One random track by an artist, on their own tracks or albums, under their name or a merged
 * alias. Each name is an indexed lookup, so only the artist's tracks are shuffled; `CROSS JOIN`
 * and the unary `+` keep SQLite, which has no statistics here, from starting at the server's tracks.
 */
export const ARTIST_SEED_SQL = `WITH names(name) AS (
       SELECT ? UNION SELECT alias_name FROM artist_aliases WHERE canonical_name = ?
     ),
     candidates(id) AS (
       SELECT t.id FROM names n CROSS JOIN tracks t ON t.artist = n.name WHERE +t.server_id = ?
       UNION
       SELECT t.id FROM names n CROSS JOIN albums a ON a.artist = n.name CROSS JOIN tracks t ON t.album_id = a.id
       WHERE +a.server_id = ?
     )
     SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name,
            ${REPLAY_GAIN_COLUMNS}
     FROM candidates c
     CROSS JOIN tracks t ON t.id = c.id
     LEFT JOIN albums a ON t.album_id = a.id
     ORDER BY random() LIMIT 1`;

export function artistSeedParams(serverId: string, artistName: string): string[] {
  return [artistName, artistName, serverId, serverId];
}

export async function loadArtistSeedTrack(serverId: string, artistName: string): Promise<PlayableTrackRow | null> {
  const db = await getDb();
  const rows = await db.select<PlayableTrackRow[]>(ARTIST_SEED_SQL, artistSeedParams(serverId, artistName));
  return rows[0] ?? null;
}
