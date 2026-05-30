import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import type { AlbumRow } from "./useAlbums";

export function useVaultAlbum() {
  return useQuery<AlbumRow | null>({
    queryKey: ["albums", "vault"],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<AlbumRow[]>(
        `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url
         FROM albums a
         JOIN tracks t ON t.album_id = a.id
         JOIN scrobble_history sh ON sh.track_id = t.id
         WHERE a.artwork_url IS NOT NULL
         GROUP BY a.id
         ORDER BY MAX(sh.scrobbled_at) ASC
         LIMIT 10`,
        []
      );
      if (rows.length === 0) return null;
      return rows[Math.floor(Math.random() * rows.length)] ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}
