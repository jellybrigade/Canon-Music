import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import type { ReplayGainCoverage } from "../lib/replaygain-coverage";

interface CoverageRow {
  total: number;
  with_track_gain: number;
  with_album_gain: number;
  with_any_gain: number;
}

async function readCoverage(serverId: string): Promise<ReplayGainCoverage> {
  const db = await getDb();
  const rows = await db.select<CoverageRow[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN replay_gain_track_gain IS NOT NULL THEN 1 ELSE 0 END) AS with_track_gain,
            SUM(CASE WHEN replay_gain_album_gain IS NOT NULL THEN 1 ELSE 0 END) AS with_album_gain,
            SUM(CASE WHEN replay_gain_track_gain IS NOT NULL
                       OR replay_gain_album_gain IS NOT NULL THEN 1 ELSE 0 END) AS with_any_gain
     FROM tracks WHERE server_id = ?`,
    [serverId]
  );
  const row = rows[0];
  // SUM over no rows is NULL, so an empty mirror has to read as zero rather than as absent.
  return {
    total: row?.total ?? 0,
    withTrackGain: row?.with_track_gain ?? 0,
    withAlbumGain: row?.with_album_gain ?? 0,
    withAnyGain: row?.with_any_gain ?? 0,
  };
}

/** Local-only: counts mirrored columns, so it never waits on a credential. */
export function useReplayGainCoverage(serverId: string | undefined) {
  const { data, isPending } = useQuery({
    queryKey: QK.replayGainCoverage(serverId),
    queryFn: () => readCoverage(serverId as string),
    enabled: !!serverId,
    staleTime: 60 * 1000,
  });
  return { coverage: data, isPending };
}
