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

  const finishQuery = useQuery<AlbumStatRow[]>({
    queryKey: ["albums", "finish-the-album"],
    queryFn: async () => {
      const db = await getDb();
      return db.select<AlbumStatRow[]>(
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url,
                a.play_count AS plays,
                COALESCE(MAX(sh.scrobbled_at), '') AS last_played
         FROM albums a
         JOIN tracks t ON t.album_id = a.id
         LEFT JOIN scrobble_history sh ON sh.track_id = t.id
         WHERE a.artwork_url IS NOT NULL
         GROUP BY a.id
         HAVING COUNT(DISTINCT sh.track_id) > 0
            AND COUNT(DISTINCT sh.track_id) < COUNT(DISTINCT t.id)
         ORDER BY last_played DESC`,
        []
      );
    },
    staleTime: 5 * 60 * 1000,
  });

  const stats = query.data ?? [];

  const cutoff = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(Date.now() / (60 * 60 * 1000))] // re-derive at most once per hour
  );

  // High-play albums heard within the last 30 days, sorted by plays desc
  const onRepeat = useMemo(() => {
    return stats.filter(s => s.last_played >= cutoff);
  }, [stats, cutoff]);

  // Albums with any play history, not heard in last 30 days — oldest first
  const rediscover = useMemo(() => {
    const recentIds = new Set(onRepeat.map(s => s.id));
    return stats
      .filter(s => !recentIds.has(s.id))
      .sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats, onRepeat]);

  // Albums with 1–3 total plays — oldest last_played first
  const hiddenGem = useMemo(() => {
    return stats
      .filter(s => s.plays >= 1 && s.plays <= 3)
      .sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats]);

  // Least-recently-played albums overall
  const vault = useMemo(() => {
    return [...stats].sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats]);

  // Set of album ids that have any play history — built from stats (not returned
  // from queryFn directly to avoid React Query structuralSharing Set-ref bug)
  const playedAlbumIds = useMemo(() => new Set(stats.map(s => s.id)), [stats]);

  const finishTheAlbum = finishQuery.data ?? [];

  return {
    ...query,
    isLoading: query.isLoading || finishQuery.isLoading,
    stats,
    onRepeat,
    rediscover,
    vault,
    hiddenGem,
    finishTheAlbum,
    playedAlbumIds,
  };
}
