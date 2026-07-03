import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import type { AlbumRow } from "../types/library";
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
import { rankCandidates, filterByTrackCount } from "../lib/fuzzy-match";
import { stripTrailingBrackets } from "../lib/album-identify";

const DIALOG_AUTO_PICK_THRESHOLD = 0.75;
const DIALOG_MIN_GAP = 0.08;

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

/**
 * Looks for an MB artist MBID already confirmed for this artist name — either
 * via the artist-identify dialog (`artist_identity`) or a previously matched
 * album by the same artist (`album_identity`). Used to disambiguate release
 * groups that share a title across different artists.
 */
export function useConfirmedArtistMbid(artistName: string) {
  return useQuery({
    queryKey: QK.confirmedArtistMbid(artistName),
    queryFn: async (): Promise<string | null> => {
      const db = await getDb();
      const fromArtistIdentity = await db.select<{ mb_artist_id: string }[]>(
        "SELECT mb_artist_id FROM artist_identity WHERE artist_name = ? AND mb_artist_id IS NOT NULL",
        [artistName]
      );
      if (fromArtistIdentity[0]) return fromArtistIdentity[0].mb_artist_id;

      const fromAlbums = await db.select<{ mb_artist_id: string }[]>(
        `SELECT ai.mb_artist_id FROM album_identity ai
         INNER JOIN albums a ON a.id = ai.album_id
         WHERE a.artist = ? AND ai.mb_artist_id IS NOT NULL AND ai.auto_matched = 0
         ORDER BY ai.confirmed_at DESC
         LIMIT 1`,
        [artistName]
      );
      return fromAlbums[0]?.mb_artist_id ?? null;
    },
    enabled: !!artistName,
    staleTime: 60 * 1000,
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
  trackCount,
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
  /** Known local release year — disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere — disambiguates same-titled releases by different artists. */
  confirmedArtistMbid?: string | null;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: QK.identifyAlbum(albumId, overrideMbRgId, overrideMbReleaseId, artist, album, trackCount, year, confirmedArtistMbid),
    queryFn: async (): Promise<AlbumLookupResult> => {
      try {
        // Step 1: resolve RG MBID — prefer explicit override, then search
        let rgId = overrideMbRgId ?? null;
        let candidates: MbReleaseGroupCandidate[] = [];

        if (!rgId) {
          let searchTitle = album;
          candidates = await searchReleaseGroups(artist, album);

          // Retry without edition noise — "The Suburbs (Deluxe Edition)" → "The Suburbs"
          if (candidates.length === 0) {
            const stripped = stripTrailingBrackets(album);
            if (stripped) {
              candidates = await searchReleaseGroups(artist, stripped);
              if (candidates.length > 0) searchTitle = stripped;
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

          // Filter by track count, then rank by fuzzy score
          const filtered = filterByTrackCount(candidates, trackCount ?? 0);
          const ranked = rankCandidates(filtered, artist, searchTitle, year, confirmedArtistMbid);
          const top = ranked[0]!;
          const second = ranked[1];
          const gap = second ? top.score - second.score : Infinity;

          // Also auto-pick when top wins on type alone (Album over Single with same title)
          const typeWins =
            top.candidate.primaryType !== "Single" &&
            second?.candidate.primaryType === "Single";

          // Auto-pick if one clear winner — user still confirms in dialog
          if (top.score >= DIALOG_AUTO_PICK_THRESHOLD && (gap >= DIALOG_MIN_GAP || typeWins)) {
            rgId = top.candidate.id;
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
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbums() });
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
      void queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbums() });
    },
  });
}

export interface FailedAlbumRow extends AlbumRow {
  track_count: number;
}

/** Returns full album rows (plus track_count) for albums that were looked up but yielded no MB match. */
export function useFailedLookupAlbums() {
  return useQuery({
    queryKey: QK.failedLookupAlbums(),
    queryFn: async (): Promise<FailedAlbumRow[]> => {
      const db = await getDb();
      return db.select<FailedAlbumRow[]>(
        `SELECT a.*,
                (SELECT COUNT(*) FROM tracks WHERE album_id = a.id) AS track_count
         FROM albums a
         INNER JOIN album_identity ai ON ai.album_id = a.id
         WHERE ai.mb_release_group_id IS NULL AND ai.looked_up_at IS NOT NULL
         ORDER BY a.artist, a.name`
      );
    },
  });
}
