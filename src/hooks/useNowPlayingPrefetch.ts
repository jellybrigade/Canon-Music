import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "../store/player";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import { fetchArtistTopTracks, fetchSimilarArtists } from "../lib/lastfm";
import type { AlbumRow } from "../types/library";

interface TopTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
}

interface SuggestedTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
}

/**
 * Warms the React Query cache for NowPlayingView's About tab when the
 * current track changes, so the tab renders immediately on first open.
 * Call once near the App root.
 */
export function useNowPlayingPrefetch() {
  const queryClient = useQueryClient();
  const artistName = usePlayerStore((s) => s.currentTrack?.artist ?? null);
  const trackId = usePlayerStore((s) => s.currentTrack?.id ?? null);

  useEffect(() => {
    if (!artistName) return;

    void queryClient.prefetchQuery({
      queryKey: QK.nowPlayingAlbums(artistName),
      queryFn: async (): Promise<AlbumRow[]> => {
        const db = await getDb();
        return db.select<AlbumRow[]>(
          `SELECT id, server_id, name, artist, year, artwork_url
           FROM albums WHERE artist = ?
           ORDER BY year IS NULL, year DESC, name`,
          [artistName]
        );
      },
      staleTime: 30 * 60 * 1000,
    });

    void queryClient.prefetchQuery({
      queryKey: QK.nowPlayingTopTracks(artistName),
      queryFn: async (): Promise<TopTrack[]> => {
        const db = await getDb();
        const trackNames = await fetchArtistTopTracks(artistName);
        if (trackNames.length > 0) {
          const localTracks = await db.select<TopTrack[]>(
            `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                    t.album_id, a.artwork_url
             FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
             WHERE t.artist = ?`,
            [artistName]
          );
          const byTitle = new Map(localTracks.map((t) => [t.title.toLowerCase(), t]));
          const matched: TopTrack[] = [];
          for (const { name } of trackNames) {
            const track = byTitle.get(name.toLowerCase());
            if (track && !matched.some((m) => m.id === track.id)) {
              matched.push(track);
              if (matched.length >= 10) break;
            }
          }
          if (matched.length > 0) return matched;
        }
        return db.select<TopTrack[]>(
          `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                  t.album_id, a.artwork_url
           FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
           WHERE t.artist = ?
           ORDER BY t.track_number, t.title
           LIMIT 10`,
          [artistName]
        );
      },
      staleTime: 30 * 60 * 1000,
    });
  }, [artistName, queryClient]);

  useEffect(() => {
    if (!artistName || !trackId) return;

    void queryClient.prefetchQuery({
      queryKey: QK.suggestedTracks(artistName, trackId),
      queryFn: async (): Promise<SuggestedTrack[]> => {
        const similarArtists = await fetchSimilarArtists(artistName);
        if (similarArtists.length === 0) return [];
        const db = await getDb();
        const placeholders = similarArtists.map(() => "?").join(", ");
        return db.select<SuggestedTrack[]>(
          `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                  t.album_id, a.artwork_url
           FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
           WHERE t.artist IN (${placeholders})
             AND t.id != ?
           ORDER BY random()
           LIMIT 10`,
          [...similarArtists, trackId]
        );
      },
      staleTime: 5 * 60 * 1000,
    });
  }, [artistName, trackId, queryClient]);
}
