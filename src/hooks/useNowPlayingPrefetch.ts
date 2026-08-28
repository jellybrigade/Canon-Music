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
 *
 * `serverId` is the plain row id, not the credential-bearing one the tab holds: these reads
 * never leave SQLite, so waiting on the keychain would only delay the warm.
 */
export function useNowPlayingPrefetch(serverId: string | null) {
  const queryClient = useQueryClient();
  const rawArtist = usePlayerStore((s) => s.currentTrack?.artist ?? null);
  const trackId = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const artistName = primaryArtistOf(rawArtist);

  useEffect(() => {
    if (!artistName || !serverId) return;

    void queryClient.prefetchQuery({
      queryKey: QK.nowPlayingAlbums(artistName, serverId),
      queryFn: () => fetchArtistAlbums(artistName, serverId),
      staleTime: NOW_PLAYING_STALE_TIME,
    });

    void queryClient.prefetchQuery({
      queryKey: QK.nowPlayingTopTracks(artistName, serverId),
      queryFn: () => fetchArtistTopTracksForNowPlaying(artistName, serverId),
      staleTime: NOW_PLAYING_STALE_TIME,
    });
  }, [artistName, serverId, queryClient]);

  useEffect(() => {
    if (!artistName || !trackId || !serverId) return;

    void queryClient.prefetchQuery({
      queryKey: QK.suggestedTracks(artistName, trackId, serverId),
      queryFn: () => fetchSuggestedTracksForNowPlaying(artistName, trackId, serverId),
      staleTime: SUGGESTED_STALE_TIME,
    });
  }, [artistName, trackId, serverId, queryClient]);
}
