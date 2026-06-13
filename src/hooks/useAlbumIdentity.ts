import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import {
  searchReleaseGroups,
  lookupReleaseGroup,
  lookupRelease,
  combineGenres,
  type MbReleaseGroupCandidate,
  type MbReleaseGroupDetail,
  type MbReleaseDetail,
  type MbGenre,
} from "../lib/musicbrainz";

// ── Stored identity row ────────────────────────────────────────────────────────

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
      const rows = await db.select<AlbumIdentityRow[]>(
        "SELECT * FROM album_identity WHERE album_id = ?",
        [albumId]
      );
      return rows[0] ?? null;
    },
    enabled: !!albumId,
    staleTime: Infinity,
  });
}

// ── Live lookup result ─────────────────────────────────────────────────────────

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

/**
 * On-demand MB lookup. Only fires when `enabled` is true.
 * Uses saved MBIDs if available; otherwise searches by artist + album strings.
 */
export function useIdentifyAlbum({
  albumId,
  artist,
  album,
  overrideMbRgId,
  overrideMbReleaseId,
  enabled,
}: {
  albumId: string;
  artist: string;
  album: string;
  overrideMbRgId?: string | null;
  overrideMbReleaseId?: string | null;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: QK.identifyAlbum(albumId, overrideMbRgId, overrideMbReleaseId, artist, album),
    queryFn: async (): Promise<AlbumLookupResult> => {
      try {
        // Step 1: resolve RG MBID — prefer explicit override, then search
        let rgId = overrideMbRgId ?? null;
        let candidates: MbReleaseGroupCandidate[] = [];

        if (!rgId) {
          candidates = await searchReleaseGroups(artist, album);
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
          if (candidates.length > 1) {
            // Multiple candidates — caller shows picker
            return {
              mbStatus: "ambiguous",
              mbDetail: null,
              mbRelease: null,
              mbCandidates: candidates,
              combinedGenres: [],
              combinedTags: [],
              error: null,
            };
          }
          rgId = candidates[0]!.id;
        }

        // Step 2: full RG lookup (genres + releases)
        const rgDetail = await lookupReleaseGroup(rgId);

        // Step 3: release lookup for combined genres
        // Use explicit override if provided, else pick first release with a date
        let releaseDetail: MbReleaseDetail | null = null;
        const releaseId =
          overrideMbReleaseId ??
          rgDetail.releases.find((r) => r.date)?.id ??
          rgDetail.releases[0]?.id ??
          null;

        if (releaseId) {
          try {
            releaseDetail = await lookupRelease(releaseId);
          } catch {
            // Non-fatal: RG detail alone is still useful
          }
        }

        const combinedGenres = combineGenres(
          rgDetail.genres,
          releaseDetail?.genres ?? []
        );
        const combinedTags = combineGenres(
          rgDetail.tags,
          releaseDetail?.tags ?? []
        );

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
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    enabled: enabled && !!albumId,
    staleTime: 60 * 60 * 1000, // 1 hour — re-fetch on explicit user action
    retry: false,
  });
}

// ── Save confirmed identity ────────────────────────────────────────────────────

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

/**
 * Single write path for album_identity rows. Accepts an optional confirmedAt
 * so bulk callers can supply their own timestamp without calling Date.now() twice.
 */
export async function persistAlbumIdentity(
  input: SaveAlbumIdentityInput & { confirmedAt?: number }
): Promise<void> {
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
    ]
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
    },
  });
}

// ── Record failed auto-lookup attempt ─────────────────────────────────────────

/**
 * Writes a minimal row marking that an auto-lookup was attempted but did not
 * produce a confident match. Uses INSERT OR IGNORE so it never clobbers a
 * confirmed row that arrived via the dialog or a race condition.
 */
// ── Failed lookup IDs (for grid badge) ───────────────────────────────────────

/** Returns the set of album IDs that were looked up but yielded no MB match. */
export function useFailedLookupAlbumIds() {
  return useQuery({
    queryKey: QK.failedLookupAlbumIds(),
    queryFn: async (): Promise<string[]> => {
      const db = await getDb();
      const rows = await db.select<{ album_id: string }[]>(
        `SELECT album_id FROM album_identity
         WHERE mb_release_group_id IS NULL AND looked_up_at IS NOT NULL`
      );
      return rows.map((r) => r.album_id);
    },
  });
}

export function useRecordFailedLookup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ albumId, matchScore }: { albumId: string; matchScore: number }) => {
      const db = await getDb();
      await db.execute(
        `INSERT OR IGNORE INTO album_identity
           (album_id, looked_up_at, match_score, auto_matched, lastfm_match_confirmed)
         VALUES (?, ?, ?, 0, 0)`,
        [albumId, Math.floor(Date.now() / 1000), matchScore]
      );
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: QK.albumIdentity(input.albumId) });
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbumIds() });
    },
  });
}
