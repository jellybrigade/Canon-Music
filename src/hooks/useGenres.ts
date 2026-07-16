import { useEffect, useMemo, useState } from "react";
import { getDb } from "../db";
import { useGenresSessionStore } from "../store/genresSessionStore";

export interface GenreRow {
  canonical_id: string;
  name: string;
  album_count: number;
}

export function useGenres() {
  const refreshTick = useGenresSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<GenreRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const db = await getDb();
      // Only show direct (leaf) canon-tree genres in the dropdown, raw: ids excluded.
      const rows = await db.select<GenreRow[]>(`
        SELECT canonical_id, name, COUNT(DISTINCT album_id) AS album_count
        FROM album_genres
        WHERE relation = 'direct'
          AND canonical_id NOT LIKE 'raw:%'
        GROUP BY canonical_id
        ORDER BY name COLLATE NOCASE
      `);
      if (!cancelled) {
        setData(rows);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return { data, isLoading };
}

// Genres drawn from the user's most recently played albums (up to 10 albums).
// Falls back to top genres by album_count when no scrobble history exists.
export function useRecentGenres() {
  const refreshTick = useGenresSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<GenreRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const db = await getDb();
      const recent = await db.select<GenreRow[]>(`
        WITH recent_albums AS (
          SELECT t.album_id, MAX(sh.scrobbled_at) AS last_played
          FROM scrobble_history sh
          JOIN tracks t ON t.id = sh.track_id
          GROUP BY t.album_id
          ORDER BY last_played DESC
          LIMIT 10
        )
        SELECT ag.canonical_id, ag.name, COUNT(DISTINCT ag.album_id) AS album_count
        FROM recent_albums ra
        JOIN album_genres ag ON ag.album_id = ra.album_id
        WHERE ag.relation = 'direct'
          AND ag.canonical_id NOT LIKE 'raw:%'
        GROUP BY ag.canonical_id
        HAVING (
          SELECT COUNT(DISTINCT ag2.album_id) FROM album_genres ag2
          WHERE ag2.canonical_id = ag.canonical_id AND ag2.relation = 'direct'
        ) >= 5
        ORDER BY MAX(ra.last_played) DESC
      `);
      const rows =
        recent.length > 0
          ? recent
          : await db.select<GenreRow[]>(`
        SELECT canonical_id, name, COUNT(DISTINCT album_id) AS album_count
        FROM album_genres
        WHERE relation = 'direct' AND canonical_id NOT LIKE 'raw:%'
        GROUP BY canonical_id
        HAVING COUNT(DISTINCT album_id) >= 5
        ORDER BY album_count DESC
        LIMIT 18
      `);
      if (!cancelled) {
        setData(rows);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const genres = useMemo(() => data ?? [], [data]);
  return { data, isLoading, genres };
}
