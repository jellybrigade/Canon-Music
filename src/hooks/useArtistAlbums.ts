import { useEffect, useRef, useState } from "react";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";
import { useArtistAlbumsSessionStore } from "../store/artistAlbumsSessionStore";

export function useArtistAlbums(artistName: string) {
  const refreshTick = useArtistAlbumsSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<AlbumRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(!!artistName);
  const prevArtistNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!artistName) {
      setData(undefined);
      setIsLoading(false);
      prevArtistNameRef.current = null;
      return;
    }
    if (prevArtistNameRef.current !== artistName) {
      setData(undefined);
    }
    prevArtistNameRef.current = artistName;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
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
      } catch (err) {
        console.error("useArtistAlbums: failed to load albums", err);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artistName, refreshTick]);

  return { data, isLoading };
}
