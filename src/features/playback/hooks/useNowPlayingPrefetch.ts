import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "../store/player";
import { QK } from "../../../lib/queryKeys";
import {
  primaryArtistOf,
  fetchArtistAlbums,
  fetchArtistTopTracksForNowPlaying,
  fetchSuggestedTracksForNowPlaying,
  NOW_PLAYING_STALE_TIME,
  SUGGESTED_STALE_TIME,
} from "../lib/nowPlayingQueries";

/** Keyed exactly as NowPlayingView's About tab reads (`primaryArtistOf`, plain server id:
 * the reads are SQLite-only). Call once near the root. */
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
