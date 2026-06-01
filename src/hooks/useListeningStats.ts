import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import type { AlbumRow } from "./useAlbums";

export interface AlbumStatRow extends AlbumRow {
  plays: number;
  last_played: string;
}

export function useListeningStats() {
  const query = useQuery<AlbumStatRow[]>({
    queryKey: ["albums", "listening-stats"],
    queryFn: async () => {
      const db = await getDb();
      return db.select<AlbumStatRow[]>(
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url,
                a.play_count + COALESCE(q.pending, 0) AS plays,
                COALESCE(MAX(sh.scrobbled_at), '') AS last_played
         FROM albums a
         LEFT JOIN tracks t ON t.album_id = a.id
         LEFT JOIN scrobble_history sh ON sh.track_id = t.id
         LEFT JOIN (
           SELECT t2.album_id AS album_id, COUNT(*) AS pending
           FROM scrobble_queue sq
           JOIN tracks t2 ON t2.id = sq.track_id
           GROUP BY t2.album_id
         ) q ON q.album_id = a.id
         WHERE a.artwork_url IS NOT NULL
         GROUP BY a.id
         HAVING plays > 0
         ORDER BY plays DESC`,
        []
      );
    },
    staleTime: 5 * 60 * 1000,
  });

  const stats = query.data ?? [];

  // High-play albums heard within the last 30 days, sorted by plays desc
  const onRepeat = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return stats.filter(s => s.last_played >= cutoff);
  }, [stats]);

  // High-play albums not heard recently — sorted by oldest last_played first
  const rediscover = useMemo(() => {
    if (stats.length === 0) return [];
    const recentIds = new Set(onRepeat.map(s => s.id));
    const medianPlays = stats[Math.floor(stats.length / 2)]?.plays ?? 1;
    return stats
      .filter(s => s.plays >= medianPlays && !recentIds.has(s.id))
      .sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats, onRepeat]);

  // Least-recently-played albums overall
  const vault = useMemo(() => {
    return [...stats].sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats]);

  return { ...query, stats, onRepeat, rediscover, vault };
}
