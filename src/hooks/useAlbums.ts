import { useEffect, useState } from "react";
import { getDb } from "../db";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import type { AlbumRow, AlbumSort } from "../types/library";
export type { AlbumRow, AlbumSort } from "../types/library";

const ORDER_BY: Record<AlbumSort, string> = {
  artist: "a.artist COLLATE NOCASE, a.name COLLATE NOCASE",
  alphabetical: "a.name COLLATE NOCASE",
  year: "a.year DESC, a.name COLLATE NOCASE",
  recently_added: "COALESCE(a.navidrome_created, a.created_at) DESC",
};

export function useAlbums(sort: AlbumSort = "artist", canonicalIds: string[] = []) {
  const refreshTick = useAlbumBrowseSessionStore((s) => s.refreshTick);
  const [data, setData] = useState<AlbumRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const canonicalIdsKey = canonicalIds.join(",");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const db = await getDb();
      const order = ORDER_BY[sort];
      const rows =
        canonicalIds.length > 0
          ? await db.select<AlbumRow[]>(
              // Join through album_genres, covers both leaf and ancestor canon ids,
              // as well as raw: synthetic ids for unmatched tags.
              `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type
               FROM albums a
               JOIN album_genres ag ON ag.album_id = a.id
               WHERE ag.canonical_id IN (${canonicalIds.map(() => "?").join(", ")})
               ORDER BY ${order}`,
              canonicalIds
            )
          : await db.select<AlbumRow[]>(
              `SELECT id, server_id, name, artist, year, artwork_url, release_type, accent_color FROM albums a ORDER BY ${order}`
            );
      if (!cancelled) {
        setData(rows);
        setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, canonicalIdsKey, refreshTick]);

  return { data, isLoading };
}
