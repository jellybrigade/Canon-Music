import { getDb } from "../../../db";
import { REPLAY_GAIN_COLUMNS, type ReplayGainColumns } from "../../../lib/replayGainRow";

export type GenreSeedRow = {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_id: string;
  artwork_url: string | null;
  album_name: string | null;
} & ReplayGainColumns;

interface GenreSeedOptions {
  serverId: string;
  canonicalId: string;
  isDirectOnly: boolean;
  limit?: number;
}

export async function loadGenreSeedTracks({ serverId, canonicalId, isDirectOnly, limit }: GenreSeedOptions): Promise<GenreSeedRow[]> {
  const db = await getDb();
  const relationFilter = isDirectOnly ? "AND ag.relation = 'direct'" : "";
  const limitClause = limit === undefined ? "" : "LIMIT ?";
  const params: unknown[] = [serverId, canonicalId];
  if (limit !== undefined) params.push(limit);
  return db.select<GenreSeedRow[]>(
    `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name,
            ${REPLAY_GAIN_COLUMNS}
     FROM tracks t
     JOIN albums a ON t.album_id = a.id
     JOIN album_genres ag ON ag.album_id = a.id
     WHERE a.server_id = ? AND ag.canonical_id = ? ${relationFilter}
     ORDER BY RANDOM()
     ${limitClause}`,
    params,
  );
}
