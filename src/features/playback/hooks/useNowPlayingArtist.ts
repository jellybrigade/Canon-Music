import type { AlbumRow } from "../../../types/library";
import { fetchArtistAlbums, fetchArtistTopTracksForNowPlaying, fetchSuggestedTracksForNowPlaying, NOW_PLAYING_STALE_TIME, SUGGESTED_STALE_TIME, type NowPlayingTrack } from "../lib/nowPlayingQueries";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../../../lib/queryKeys";

export type TopTrack = NowPlayingTrack;
export type SuggestedTrack = NowPlayingTrack;

export function useNowPlayingAlbums(artistName: string | null, serverId: string) {
  return useQuery({
    queryKey: QK.nowPlayingAlbums(artistName, serverId),
    queryFn: (): Promise<AlbumRow[]> => fetchArtistAlbums(artistName!, serverId),
    enabled: !!artistName,
    // Matches what useNowPlayingPrefetch warms it with. Left at the default, the prefetched
    // entry was stale the instant it landed and the tab re-ran the query on every open.
    staleTime: NOW_PLAYING_STALE_TIME,
  });
}

export function useNowPlayingTopTracks(artistName: string | null, serverId: string) {
  return useQuery({
    queryKey: QK.nowPlayingTopTracks(artistName, serverId),
    queryFn: (): Promise<TopTrack[]> => fetchArtistTopTracksForNowPlaying(artistName!, serverId),
    enabled: !!artistName,
    staleTime: NOW_PLAYING_STALE_TIME,
  });
}

export function useSuggestedTracks(artistName: string | null, currentTrackId: string | null, serverId: string) {
  return useQuery({
    queryKey: QK.suggestedTracks(artistName, currentTrackId, serverId),
    queryFn: (): Promise<SuggestedTrack[]> =>
      fetchSuggestedTracksForNowPlaying(artistName!, currentTrackId, serverId),
    enabled: !!artistName,
    staleTime: SUGGESTED_STALE_TIME,
  });
}
