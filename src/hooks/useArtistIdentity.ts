import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import {
  searchArtists,
  lookupArtist,
  type MbArtistCandidate,
  type MbArtistDetail,
} from "../lib/musicbrainz";

// ── Stored identity row ────────────────────────────────────────────────────────

export interface ArtistIdentityRow {
  artist_name: string;
  mb_artist_id: string | null;
  lastfm_artist_name: string | null;
  confirmed_at: number | null;
}

export function useArtistIdentity(artistName: string) {
  return useQuery({
    queryKey: QK.artistIdentity(artistName),
    queryFn: async (): Promise<ArtistIdentityRow | null> => {
      const db = await getDb();
      const rows = await db.select<ArtistIdentityRow[]>(
        "SELECT * FROM artist_identity WHERE artist_name = ?",
        [artistName]
      );
      return rows[0] ?? null;
    },
    enabled: !!artistName,
    staleTime: Infinity,
  });
}

// ── Live lookup result ─────────────────────────────────────────────────────────

export type MatchStatus = "found" | "ambiguous" | "not_found" | "error";

export interface ArtistLookupResult {
  mbStatus: MatchStatus;
  mbDetail: MbArtistDetail | null;
  mbCandidates: MbArtistCandidate[];
  error: string | null;
}

/**
 * On-demand MB artist lookup. Only fires when `enabled` is true.
 * Uses saved MBID if available; otherwise searches by name.
 */
export function useIdentifyArtist({
  artistName,
  overrideMbArtistId,
  enabled,
}: {
  artistName: string;
  overrideMbArtistId?: string | null;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: QK.identifyArtist(artistName, overrideMbArtistId),
    queryFn: async (): Promise<ArtistLookupResult> => {
      try {
        let artistId = overrideMbArtistId ?? null;
        let candidates: MbArtistCandidate[] = [];

        if (!artistId) {
          candidates = await searchArtists(artistName);
          if (candidates.length === 0) {
            return {
              mbStatus: "not_found",
              mbDetail: null,
              mbCandidates: [],
              error: null,
            };
          }
          if (candidates.length > 1) {
            return {
              mbStatus: "ambiguous",
              mbDetail: null,
              mbCandidates: candidates,
              error: null,
            };
          }
          artistId = candidates[0]!.id;
        }

        const detail = await lookupArtist(artistId);
        return {
          mbStatus: "found",
          mbDetail: detail,
          mbCandidates: candidates,
          error: null,
        };
      } catch (e) {
        return {
          mbStatus: "error",
          mbDetail: null,
          mbCandidates: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    enabled: enabled && !!artistName,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

// ── Save confirmed identity ────────────────────────────────────────────────────

export interface SaveArtistIdentityInput {
  artistName: string;
  mbArtistId: string | null;
  lastfmArtistName: string | null;
}

export function useSaveArtistIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveArtistIdentityInput) => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO artist_identity (artist_name, mb_artist_id, lastfm_artist_name, confirmed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(artist_name) DO UPDATE SET
           mb_artist_id       = excluded.mb_artist_id,
           lastfm_artist_name = excluded.lastfm_artist_name,
           confirmed_at       = excluded.confirmed_at,
           enriched_at        = NULL`,
        [
          input.artistName,
          input.mbArtistId,
          input.lastfmArtistName,
          Math.floor(Date.now() / 1000),
        ]
      );
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: QK.artistIdentity(input.artistName),
      });
      void queryClient.invalidateQueries({
        queryKey: QK.artistEnrichment(input.artistName),
      });
      void queryClient.invalidateQueries({
        queryKey: QK.lastfmArtistTopTracks(input.lastfmArtistName ?? input.artistName),
      });
    },
  });
}
