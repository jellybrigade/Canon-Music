// Runs only when `mb.auto_identify` is on, names are non-empty and `needsAutoIdentify` says so.
// Side-effect free: the caller saves or records the lookup based on `decision`.
import { useQuery } from "@tanstack/react-query";
import { QK } from "../../../lib/queryKeys";
import type { AutoDecision, AutoIdentifyResult } from "../lib/albumIdentify";
import { autoIdentifyAlbum, needsAutoIdentify } from "../lib/albumIdentify";
import type { AlbumIdentityRow } from "./useAlbumIdentity";

export type { AutoDecision, AutoIdentifyResult };

export function useAutoIdentifyAlbum({
  albumId,
  artist,
  album,
  trackCount,
  durationSeconds,
  year,
  confirmedArtistMbid,
  mbAutoIdentify,
  existingIdentity,
}: {
  albumId: string;
  artist: string;
  album: string;
  /** Zero while the tracks are still arriving; the lookup waits, since track count decides album vs single. */
  trackCount: number;
  /** Total local length, tells an album from its same-titled single. */
  durationSeconds: number;
  /** Known local release year, disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere, `null` when there is none, `undefined` while loading. */
  confirmedArtistMbid: string | null | undefined;
  mbAutoIdentify: boolean;
  /** The row from useAlbumIdentity, `undefined` while loading, `null` when there is none. */
  existingIdentity: Pick<AlbumIdentityRow, "mb_release_group_id" | "confirmed_at" | "looked_up_at"> | null | undefined;
}) {
  const isReady =
    mbAutoIdentify &&
    !!albumId &&
    !!artist &&
    !!album &&
    trackCount > 0 &&
    confirmedArtistMbid !== undefined &&
    existingIdentity !== undefined;
  return useQuery({
    queryKey: QK.autoIdentifyAlbum(albumId, trackCount, durationSeconds, confirmedArtistMbid),
    queryFn: (): Promise<AutoIdentifyResult> =>
      autoIdentifyAlbum({ artist, album, trackCount, durationSeconds, year, confirmedArtistMbid }),
    enabled: isReady && needsAutoIdentify(existingIdentity, Math.floor(Date.now() / 1000)),
    staleTime: Infinity,
    retry: false,
  });
}
