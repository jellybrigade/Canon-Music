import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "../store/player";
import { QK } from "../lib/query-keys";
import {
  primaryArtistOf,
  fetchArtistAlbums,
  fetchArtistTopTracksForNowPlaying,
  fetchSuggestedTracksForNowPlaying,
  NOW_PLAYING_STALE_TIME,
  SUGGESTED_STALE_TIME,
} from "../lib/now-playing-queries";

/**
 * Warms the React Query cache for NowPlayingView's About tab when the
 * current track changes, so the tab renders immediately on first open.
 * Call once near the App root.
 *
 * The artist name is run through `primaryArtistOf` because that is what the tab keys on.
 * Keying this on the raw name meant every "X feat. Y" track warmed an entry the tab never
 * read, so the collaboration tracks paid for the prefetch and got none of the benefit.
 */
export function useNowPlayingPrefetch() {
  const queryClient = useQueryClient();
  const rawArtist = usePlayerStore((s) => s.currentTrack?.artist ?? null);
  const trackId = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const artistName = primaryArtistOf(rawArtist);

  useEffect(() => {
    if (!artistName) return;

    void queryClient.prefetchQuery({
      queryKey: QK.nowPlayingAlbums(artistName),
      queryFn: () => fetchArtistAlbums(artistName),
      staleTime: NOW_PLAYING_STALE_TIME,
    });

    void queryClient.prefetchQuery({
      queryKey: QK.nowPlayingTopTracks(artistName),
      queryFn: () => fetchArtistTopTracksForNowPlaying(artistName),
      staleTime: NOW_PLAYING_STALE_TIME,
    });
  }, [artistName, queryClient]);

  useEffect(() => {
    if (!artistName || !trackId) return;

    void queryClient.prefetchQuery({
      queryKey: QK.suggestedTracks(artistName, trackId),
      queryFn: () => fetchSuggestedTracksForNowPlaying(artistName, trackId),
      staleTime: SUGGESTED_STALE_TIME,
    });
  }, [artistName, trackId, queryClient]);
}
