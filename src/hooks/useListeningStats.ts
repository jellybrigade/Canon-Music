import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";
import { QK } from "../lib/query-keys";

export interface AlbumStatRow extends AlbumRow {
  plays: number;
  last_played: string;
}

/** A partially-heard album, carrying the counts both "finish the album" and
 *  "almost done" are derived from. */
export interface PartialAlbumRow extends AlbumStatRow {
  heard: number;
  total: number;
}

export function useListeningStats() {
  const query = useQuery<AlbumStatRow[]>({
    queryKey: QK.albumsListeningStats(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<AlbumStatRow[]>(
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url,
                a.play_count + COALESCE(q.pending, 0) AS plays,
                -- Local scrobbles only know about plays through Canon, so on a fresh
                -- install against an established server every album would come back
                -- with no timestamp at all and "On Repeat" would be permanently empty.
                -- Fall back to the server's own last-played. scrobbled_at is stored as
                -- "YYYY-MM-DD HH:MM:SS" and played_at is ISO 8601, so the local side is
                -- reshaped to match before either is compared lexicographically here or
                -- against the ISO cutoff below.
                COALESCE(
                  MAX(
                    MAX(
                      COALESCE(REPLACE(sh.scrobbled_at, ' ', 'T') || 'Z', ''),
                      COALESCE(a.played_at, '')
                    )
                  ),
                  ''
                ) AS last_played
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

  // "Finish the album" and "Almost done" used to be two queries that scanned the same
  // albums x tracks x scrobble_history join and differed only in their HAVING clause.
  // One partially-heard pass serves both: almost-done is the subset where at least half
  // the tracks have been heard.
  const partialQuery = useQuery<PartialAlbumRow[]>({
    queryKey: QK.albumsPartiallyHeard(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<PartialAlbumRow[]>(
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url,
                a.play_count AS plays,
                '' AS last_played,
                COUNT(CASE WHEN t.play_count > 0 OR sh.track_id IS NOT NULL THEN 1 END) AS heard,
                COUNT(t.id) AS total
         FROM albums a
         JOIN tracks t ON t.album_id = a.id
         LEFT JOIN (SELECT DISTINCT track_id FROM scrobble_history) sh ON sh.track_id = t.id
         WHERE a.artwork_url IS NOT NULL
         GROUP BY a.id
         HAVING heard > 0 AND heard < total
         ORDER BY a.name`,
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

  // Albums with any play history, not heard in last 30 days, oldest first
  const rediscover = useMemo(() => {
    const recentIds = new Set(onRepeat.map(s => s.id));
    return stats
      .filter(s => !recentIds.has(s.id))
      .sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats, onRepeat]);

  // Albums with 1-3 total plays, oldest last_played first
  const hiddenGem = useMemo(() => {
    return stats
      .filter(s => s.plays >= 1 && s.plays <= 3)
      .sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats]);

  // Least-recently-played albums overall
  const vault = useMemo(() => {
    return [...stats].sort((a, b) => a.last_played.localeCompare(b.last_played));
  }, [stats]);

  // Set of album ids that have any play history, built from stats (not returned
  // from queryFn directly to avoid React Query structuralSharing Set-ref bug)
  const playedAlbumIds = useMemo(() => new Set(stats.map(s => s.id)), [stats]);

  const finishTheAlbum = partialQuery.data ?? [];
  // Albums where >=50% of tracks have been played, but not 100%
  const almostDone = useMemo(
    () => finishTheAlbum.filter(a => a.heard * 2 >= a.total),
    [finishTheAlbum]
  );

  return {
    ...query,
    isLoading: query.isLoading || partialQuery.isLoading,
    stats,
    onRepeat,
    rediscover,
    vault,
    hiddenGem,
    finishTheAlbum,
    almostDone,
    playedAlbumIds,
  };
}
