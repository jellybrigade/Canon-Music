import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import type { TrackRow } from "../types/library";
export type { TrackRow } from "../types/library";

export function useTracks(albumId: string | null) {
  return useQuery({
    queryKey: QK.tracks(albumId),
    enabled: albumId !== null,
    queryFn: async () => {
      const db = await getDb();
      return db.select<TrackRow[]>(
        `SELECT id, title, artist, album_artist, album_id, genre, track_number, disc_number, year, duration, file_path
         FROM tracks
         WHERE album_id = ?
         ORDER BY disc_number, track_number`,
        [albumId]
      );
    },
  });
}
