import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { HOME_GC_TIME, HOME_STALE_TIME } from "../lib/homeQueryTiming";
import { QK } from "../lib/queryKeys";
import { reissueSql } from "../lib/reissue";
import { lookedUpReleaseDateSql, ownReleaseDateSql } from "../lib/releaseLookupSql";
import type { AlbumRow } from "../types/library";

export function useRecentlyReleasedAlbums(limit = 20) {
  return useQuery<AlbumRow[]>({
    queryKey: QK.recentlyReleased(limit),
    queryFn: async () => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        // Most tags carry only a year, so a whole year's albums would tie. A full date from the
        // tags (release, then original), else MusicBrainz, else a looked-up source, breaks the tie,
        // but only if it agrees with the album's year.
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url
         FROM albums a
         LEFT JOIN album_identity ai ON ai.album_id = a.id
         WHERE a.year IS NOT NULL AND NOT ${reissueSql("a", "ai")}
         ORDER BY
           COALESCE(${ownReleaseDateSql("a", "ai")}, ${lookedUpReleaseDateSql("a")}, printf('%04d', a.year)) DESC,
           a.navidrome_created DESC,
           a.id
         LIMIT ?`,
        [limit],
      );
    },
    staleTime: HOME_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
}
