import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";

export interface TrackRow {
  id: string;
  title: string;
  artist: string | null;
  album_artist: string | null;
  album_id: string;
  genre: string | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  duration: number | null;
  file_path: string | null;
}

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
