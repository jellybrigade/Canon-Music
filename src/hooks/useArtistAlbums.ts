import { useEffect, useRef, useState } from "react";
import { getDb } from "../db";
import type { AlbumRow } from "../types/library";
import { useArtistAlbumsSessionStore } from "../store/artistAlbumsSessionStore";

export function useArtistAlbums(artistName: string, serverId: string) {
  const refreshTick = useArtistAlbumsSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<AlbumRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(!!artistName);
  // Carries the server as well as the name: switching servers under one mount changes which
  // rows are correct, so the previous server's list has to be dropped like a stale artist's.
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!artistName || !serverId) {
      setData(undefined);
      setIsLoading(false);
      prevKeyRef.current = null;
      return;
    }
    const key = `${serverId}\u0000${artistName}`;
    if (prevKeyRef.current !== key) {
      setData(undefined);
    }
    prevKeyRef.current = key;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.select<AlbumRow[]>(
          `SELECT id, server_id, name, artist, year, artwork_url, release_type
           FROM albums
           WHERE server_id = ?
             AND (artist = ?
              OR artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
           ORDER BY year IS NULL, year DESC, name`,
          [serverId, artistName, artistName]
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
  }, [artistName, serverId, refreshTick]);

  return { data, isLoading };
}
