// Runs only when `mb.auto_identify` is on, names are non-empty and no identity row exists.
// Side-effect free: the caller saves or records the lookup based on `decision`.
import { useQuery } from "@tanstack/react-query";
import { autoIdentifyAlbum } from "../lib/albumIdentify";
import type { AutoDecision, AutoIdentifyResult } from "../lib/albumIdentify";
import { QK } from "../../../lib/queryKeys";
import type { AlbumIdentityRow } from "./useAlbumIdentity";

export type { AutoDecision, AutoIdentifyResult };

export function useAutoIdentifyAlbum({
  albumId,
  artist,
  album,
  trackCount,
  year,
  confirmedArtistMbid,
  mbAutoIdentify,
  existingIdentity,
  identityLoaded,
}: {
  albumId: string;
  artist: string;
  album: string;
  trackCount: number;
  /** Known local release year, disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere, disambiguates same-titled releases by different artists. */
  confirmedArtistMbid?: string | null;
  mbAutoIdentify: boolean;
  /** The row from useAlbumIdentity, undefined while loading, null when no row. */
  existingIdentity: AlbumIdentityRow | null | undefined;
  /** True once useAlbumIdentity has resolved (isSuccess). */
  identityLoaded: boolean;
}) {
  return useQuery({
    queryKey: QK.autoIdentifyAlbum(albumId, confirmedArtistMbid),
    queryFn: (): Promise<AutoIdentifyResult> =>
      autoIdentifyAlbum({ artist, album, trackCount, year, confirmedArtistMbid }),
    enabled:
      mbAutoIdentify &&
      !!albumId &&
      !!artist &&
      !!album &&
      identityLoaded &&
      existingIdentity === null,  // null = no row = never looked up; undefined = still loading
    staleTime: Infinity,
    retry: false,
  });
}
