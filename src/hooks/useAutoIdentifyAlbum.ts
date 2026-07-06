/**
 * Auto-identify an album on mount via MusicBrainz search + fuzzy scoring.
 *
 * Only fires when:
 *   1. The MB auto-identify setting is enabled ("mb.auto_identify" = "true")
 *   2. Artist + album strings are non-empty
 *   3. The identity query has settled AND no row exists yet (never looked up)
 *
 * Returns a result describing the outcome without side effects, AlbumDetail
 * is responsible for calling useSaveAlbumIdentity / useRecordFailedLookup
 * based on the `decision` field.
 */
import { useQuery } from "@tanstack/react-query";
import { autoIdentifyAlbum } from "../lib/album-identify";
import type { AutoDecision, AutoIdentifyResult } from "../lib/album-identify";
import { QK } from "../lib/query-keys";
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
