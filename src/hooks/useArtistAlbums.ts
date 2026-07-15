import { useEffect, useState } from "react";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";
import { useArtistAlbumsSessionStore } from "../store/artistAlbumsSessionStore";

export function useArtistAlbums(artistName: string) {
  const refreshTick = useArtistAlbumsSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<AlbumRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(!!artistName);

  useEffect(() => {
    if (!artistName) {
      setData(undefined);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const db = await getDb();
      const rows = await db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type
         FROM albums
         WHERE artist = ?
            OR artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY year IS NULL, year DESC, name`,
        [artistName, artistName]
      );
      if (!cancelled) {
        setData(rows);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artistName, refreshTick]);

  return { data, isLoading };
}
