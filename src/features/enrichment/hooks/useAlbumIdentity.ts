import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  combineGenres,
  lookupRelease,
  lookupReleaseGroup,
  type MbGenre,
  type MbReleaseDetail,
  type MbReleaseGroupCandidate,
  type MbReleaseGroupDetail,
  searchReleaseGroups,
} from "../../../clients/musicbrainz";
import { getDb } from "../../../db";
import { errorMessage } from "../../../lib/errorMessage";
import { QK } from "../../../lib/queryKeys";
import type { AlbumRow } from "../../../types/library";
import { pickClearWinner, rankCandidates, stripTrailingBrackets } from "../lib/fuzzyMatch";

const DIALOG_AUTO_PICK_THRESHOLD = 0.75;
const DIALOG_MIN_GAP = 0.08;

export interface AlbumIdentityRow {
  album_id: string;
  mb_release_group_id: string | null;
  mb_release_id: string | null;
  mb_artist_id: string | null;
  lastfm_artist_name: string | null;
  lastfm_album_name: string | null;
  lastfm_match_confirmed: number;
  combined_genres_json: string | null;
  combined_tags_json: string | null;
  label: string | null;
  country: string | null;
  catalog_number: string | null;
  barcode: string | null;
  release_date: string | null;
  confirmed_at: number | null;
  /** 1 = auto-matched silently; 0 = user-confirmed via dialog */
  auto_matched: number;
  /** Our fuzzy match score * 100 at time of auto-lookup. Null for user-confirmed rows. */
  match_score: number | null;
  /** Unix timestamp of auto-lookup attempt (set even on failed lookups). */
  looked_up_at: number | null;
}

export function useAlbumIdentity(albumId: string) {
  return useQuery({
    queryKey: QK.albumIdentity(albumId),
    queryFn: async (): Promise<AlbumIdentityRow | null> => {
      const db = await getDb();
      const rows = await db.select<AlbumIdentityRow[]>("SELECT * FROM album_identity WHERE album_id = ?", [albumId]);
      return rows[0] ?? null;
    },
    enabled: !!albumId,
    staleTime: Infinity,
  });
}

/** The MusicBrainz release the album's files are tagged with, as of the last sync. */
export async function readTaggedReleaseMbid(
  db: Awaited<ReturnType<typeof getDb>>,
  albumId: string,
): Promise<string | null> {
  const rows = await db.select<{ mb_release_id: string | null }[]>("SELECT mb_release_id FROM albums WHERE id = ?", [
    albumId,
  ]);
  return rows[0]?.mb_release_id ?? null;
}

export function useTaggedReleaseMbid(albumId: string) {
  return useQuery({
    queryKey: QK.taggedReleaseMbid(albumId),
    queryFn: async () => readTaggedReleaseMbid(await getDb(), albumId),
  });
}

/** Used to disambiguate release groups that share a title across different artists. */
export function useConfirmedArtistMbid(artistName: string) {
  return useQuery({
    queryKey: QK.confirmedArtistMbid(artistName),
    queryFn: async (): Promise<string | null> => {
      const db = await getDb();
      const fromArtistIdentity = await db.select<{ mb_artist_id: string }[]>(
        "SELECT mb_artist_id FROM artist_identity WHERE artist_name = ? AND mb_artist_id IS NOT NULL",
        [artistName],
      );
      if (fromArtistIdentity[0]) return fromArtistIdentity[0].mb_artist_id;

      const fromAlbums = await db.select<{ mb_artist_id: string }[]>(
        `SELECT ai.mb_artist_id FROM album_identity ai
         INNER JOIN albums a ON a.id = ai.album_id
         WHERE a.artist = ? AND ai.mb_artist_id IS NOT NULL AND ai.auto_matched = 0
         ORDER BY ai.confirmed_at DESC
         LIMIT 1`,
        [artistName],
      );
      return fromAlbums[0]?.mb_artist_id ?? null;
    },
    enabled: !!artistName,
    staleTime: 60 * 1000,
  });
}

export type MatchStatus = "found" | "ambiguous" | "not_found" | "error";

export interface AlbumLookupResult {
  mbStatus: MatchStatus;
  mbDetail: MbReleaseGroupDetail | null;
  mbRelease: MbReleaseDetail | null;
  mbCandidates: MbReleaseGroupCandidate[];
  combinedGenres: MbGenre[];
  combinedTags: MbGenre[];
  error: string | null;
}

export function useIdentifyAlbum({
  albumId,
  artist,
  album,
  overrideMbRgId,
  overrideMbReleaseId,
  trackCount,
  durationSeconds,
  year,
  confirmedArtistMbid,
  enabled,
}: {
  albumId: string;
  artist: string;
  album: string;
  overrideMbRgId?: string | null;
  overrideMbReleaseId?: string | null;
  trackCount?: number;
  /** Total local length, tells an album from its same-titled single. */
  durationSeconds?: number;
  /** Known local release year, disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere, disambiguates same-titled releases by different artists. */
  confirmedArtistMbid?: string | null;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: QK.identifyAlbum(
      albumId,
      overrideMbRgId,
      overrideMbReleaseId,
      artist,
      album,
      trackCount,
      durationSeconds,
      year,
      confirmedArtistMbid,
    ),
    queryFn: async (): Promise<AlbumLookupResult> => {
      try {
        let rgId = overrideMbRgId ?? null;
        let candidates: MbReleaseGroupCandidate[] = [];

        if (!rgId) {
          candidates = await searchReleaseGroups(artist, album);

          // Retry without edition noise, "The Suburbs (Deluxe Edition)" → "The Suburbs"
          if (candidates.length === 0) {
            const stripped = stripTrailingBrackets(album);
            if (stripped) {
              candidates = await searchReleaseGroups(artist, stripped);
            }
          }

          if (candidates.length === 0) {
            return {
              mbStatus: "not_found",
              mbDetail: null,
              mbRelease: null,
              mbCandidates: [],
              combinedGenres: [],
              combinedTags: [],
              error: null,
            };
          }

          const ranked = rankCandidates(candidates, {
            artist,
            title: album,
            year,
            confirmedArtistMbid,
            trackCount,
            durationSeconds,
          });
          const winner = pickClearWinner(ranked, { minScore: DIALOG_AUTO_PICK_THRESHOLD, minGap: DIALOG_MIN_GAP });

          if (winner) {
            rgId = winner.candidate.id;
            candidates = ranked.map((r) => r.candidate);
          } else {
            // Return ranked candidates so picker shows best match first
            return {
              mbStatus: "ambiguous",
              mbDetail: null,
              mbRelease: null,
              mbCandidates: ranked.map((r) => r.candidate),
              combinedGenres: [],
              combinedTags: [],
              error: null,
            };
          }
        }

        const rgDetail = await lookupReleaseGroup(rgId);

        let releaseDetail: MbReleaseDetail | null = null;
        const releaseId =
          overrideMbReleaseId ?? rgDetail.releases.find((r) => r.date)?.id ?? rgDetail.releases[0]?.id ?? null;

        if (releaseId) {
          try {
            releaseDetail = await lookupRelease(releaseId);
          } catch {
            // Non-fatal: RG detail alone is still useful
          }
        }

        const combinedGenres = combineGenres(rgDetail.genres, releaseDetail?.genres ?? []);
        const combinedTags = combineGenres(rgDetail.tags, releaseDetail?.tags ?? []);

        return {
          mbStatus: "found",
          mbDetail: rgDetail,
          mbRelease: releaseDetail,
          mbCandidates: candidates,
          combinedGenres,
          combinedTags,
          error: null,
        };
      } catch (e) {
        return {
          mbStatus: "error",
          mbDetail: null,
          mbRelease: null,
          mbCandidates: [],
          combinedGenres: [],
          combinedTags: [],
          error: errorMessage(e),
        };
      }
    },
    enabled: enabled && !!albumId,
    staleTime: 60 * 60 * 1000, // 1 hour, re-fetch on explicit user action
    retry: false,
  });
}

export interface SaveAlbumIdentityInput {
  albumId: string;
  mbReleaseGroupId: string | null;
  mbReleaseId: string | null;
  mbArtistId: string | null;
  lastfmArtistName: string | null;
  lastfmAlbumName: string | null;
  lastfmMatchConfirmed: boolean;
  combinedGenres: MbGenre[];
  combinedTags: MbGenre[];
  label: string | null;
  country: string | null;
  catalogNumber: string | null;
  barcode: string | null;
  releaseDate: string | null;
  /** True when auto-identified silently (not user-confirmed via dialog). */
  autoMatched?: boolean;
  /** Our fuzzy match score * 100 at time of auto-lookup. */
  matchScore?: number | null;
}

/** Accepts an optional confirmedAt so bulk callers can supply their own timestamp
 * instead of calling Date.now() twice. */
export async function persistAlbumIdentity(input: SaveAlbumIdentityInput & { confirmedAt?: number }): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT OR REPLACE INTO album_identity
       (album_id, mb_release_group_id, mb_release_id, mb_artist_id,
        lastfm_artist_name, lastfm_album_name, lastfm_match_confirmed,
        combined_genres_json, combined_tags_json, label, country, catalog_number, barcode,
        release_date, confirmed_at, auto_matched, match_score, looked_up_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.albumId,
      input.mbReleaseGroupId,
      input.mbReleaseId,
      input.mbArtistId,
      input.lastfmArtistName,
      input.lastfmAlbumName,
      input.lastfmMatchConfirmed ? 1 : 0,
      input.combinedGenres.length > 0 ? JSON.stringify(input.combinedGenres) : null,
      input.combinedTags.length > 0 ? JSON.stringify(input.combinedTags) : null,
      input.label,
      input.country,
      input.catalogNumber,
      input.barcode,
      input.releaseDate,
      input.confirmedAt ?? now,
      input.autoMatched ? 1 : 0,
      input.matchScore ?? null,
      now,
    ],
  );
}

export function useSaveAlbumIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SaveAlbumIdentityInput) => persistAlbumIdentity(input),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: QK.albumIdentity(input.albumId) });
      void queryClient.invalidateQueries({ queryKey: QK.normalizedTags(input.albumId) });
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbumIds() });
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbums() });
    },
  });
}

export async function readFailedLookupAlbumIds(
  db: Awaited<ReturnType<typeof getDb>>,
  serverId: string,
): Promise<string[]> {
  const rows = await db.select<{ album_id: string }[]>(
    `SELECT ai.album_id FROM album_identity ai
     INNER JOIN albums a ON a.id = ai.album_id
     WHERE a.server_id = ? AND ai.mb_release_group_id IS NULL AND ai.looked_up_at IS NOT NULL
     ORDER BY ai.album_id`,
    [serverId],
  );
  return rows.map((r) => r.album_id);
}

/** Album ids on this server that were looked up but yielded no MB match. */
export function useFailedLookupAlbumIds(serverId: string | undefined) {
  return useQuery({
    queryKey: QK.failedLookupAlbumIdsFor(serverId ?? ""),
    queryFn: async () => readFailedLookupAlbumIds(await getDb(), serverId ?? ""),
    enabled: !!serverId,
  });
}

/** Records an automatic lookup that found no match; a row the user confirmed is never touched. */
export async function recordFailedLookup(
  db: Awaited<ReturnType<typeof getDb>>,
  { albumId, matchScore, lookedUpAt }: { albumId: string; matchScore: number; lookedUpAt: number },
): Promise<void> {
  await db.execute(
    `INSERT INTO album_identity (album_id, looked_up_at, match_score, auto_matched, lastfm_match_confirmed)
     VALUES (?, ?, ?, 0, 0)
     ON CONFLICT(album_id) DO UPDATE SET looked_up_at = excluded.looked_up_at, match_score = excluded.match_score
     WHERE album_identity.mb_release_group_id IS NULL AND album_identity.confirmed_at IS NULL`,
    [albumId, lookedUpAt, matchScore],
  );
}

export function useRecordFailedLookup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ albumId, matchScore }: { albumId: string; matchScore: number }) =>
      recordFailedLookup(await getDb(), { albumId, matchScore, lookedUpAt: Math.floor(Date.now() / 1000) }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: QK.albumIdentity(input.albumId) });
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbumIds() });
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbums() });
    },
  });
}

/** `track_count` and `duration_seconds` of album `a`, as `albumShapeOf` reads them: length 0 if any track lacks one. */
export const ALBUM_SHAPE_COLUMNS = `(SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id AND t.server_id = a.server_id) AS track_count,
  (SELECT CASE WHEN COUNT(*) > 0 AND COUNT(*) = COUNT(NULLIF(t.duration, 0)) THEN SUM(t.duration) ELSE 0 END
   FROM tracks t WHERE t.album_id = a.id AND t.server_id = a.server_id) AS duration_seconds`;

export interface FailedAlbumRow extends AlbumRow {
  track_count: number;
  duration_seconds: number;
  mb_release_id: string | null;
}

/** Album rows (plus track_count) on one server that were looked up but yielded no MB match. */
export async function readFailedLookupAlbums(
  db: Awaited<ReturnType<typeof getDb>>,
  serverId: string,
): Promise<FailedAlbumRow[]> {
  return db.select<FailedAlbumRow[]>(
    `SELECT a.*, ${ALBUM_SHAPE_COLUMNS}
     FROM albums a
     INNER JOIN album_identity ai ON ai.album_id = a.id
     WHERE a.server_id = ? AND ai.mb_release_group_id IS NULL AND ai.looked_up_at IS NOT NULL
     ORDER BY a.artist, a.name, a.id`,
    [serverId],
  );
}

export function useFailedLookupAlbums(serverId: string) {
  return useQuery({
    queryKey: QK.failedLookupAlbumsFor(serverId),
    queryFn: async () => readFailedLookupAlbums(await getDb(), serverId),
  });
}
