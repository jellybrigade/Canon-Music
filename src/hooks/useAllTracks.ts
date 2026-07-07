import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";

export interface AllTrackRow {
  id: string;
  title: string;
  artist: string | null;
  album_artist: string | null;
  album_id: string;
  album_name: string | null;
  album_artwork_url: string | null;
  genre: string | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  duration: number | null;
  play_count: number | null;
  bit_rate: number | null;
  suffix: string | null;
  replay_gain_track_gain: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_gain: number | null;
  replay_gain_album_peak: number | null;
}

export function useAllTracks() {
  return useQuery({
    queryKey: QK.allTracks(),
    staleTime: Infinity,
    queryFn: async () => {
      const db = await getDb();
      return db.select<AllTrackRow[]>(
        `SELECT t.id, t.title, t.artist, t.album_artist, t.album_id,
                a.name AS album_name, a.artwork_url AS album_artwork_url,
                t.genre, t.track_number, t.disc_number, t.year, t.duration,
                t.play_count, t.bit_rate, t.suffix,
                t.replay_gain_track_gain, t.replay_gain_track_peak,
                t.replay_gain_album_gain, t.replay_gain_album_peak
         FROM tracks t
         LEFT JOIN albums a ON a.id = t.album_id
         ORDER BY t.artist COLLATE NOCASE, a.name COLLATE NOCASE, t.disc_number, t.track_number`
      );
    },
  });
}
