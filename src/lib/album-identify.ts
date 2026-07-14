/**
 * Core MB auto-identify logic as a plain async function, no React hooks.
 * Used by useAutoIdentifyAlbum (per-album, on mount) and bulk sync (SettingsView).
 */
import {
  searchReleaseGroups,
  lookupReleaseGroup,
  lookupRelease,
  combineGenres,
  type MbReleaseGroupDetail,
  type MbReleaseDetail,
  type MbGenre,
  type MbReleaseGroupCandidate,
} from "./musicbrainz";
import { rankCandidates, filterByTrackCount } from "./fuzzy-match";

export type AutoDecision =
  | "auto_confirmed"
  | "not_found"
  | "ambiguous"
  | "needs_review"
  | "error";

export interface AutoIdentifyResult {
  decision: AutoDecision;
  score: number;
  top: MbReleaseGroupCandidate | null;
  detail: MbReleaseGroupDetail | null;
  release: MbReleaseDetail | null;
  combinedGenres: MbGenre[];
  combinedTags: MbGenre[];
  error: string | null;
}

const AUTO_CONFIRM_THRESHOLD = 0.90;
const MIN_SCORE_GAP = 0.10;

export function stripTrailingBrackets(title: string): string | null {
  const stripped = title.replace(/\s*[\(\[].*?[\)\]]\s*$/, "").trim();
  return stripped !== title && stripped.length > 0 ? stripped : null;
}

export async function autoIdentifyAlbum({
  artist,
  album,
  trackCount = 0,
  year = null,
  confirmedArtistMbid = null,
}: {
  artist: string;
  album: string;
  trackCount?: number;
  /** Known local release year, disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere, disambiguates same-titled releases by different artists. */
  confirmedArtistMbid?: string | null;
}): Promise<AutoIdentifyResult> {
  try {
    let candidates = await searchReleaseGroups(artist, album);
    let searchTitle = album;

    const stripped = stripTrailingBrackets(album);

    if (candidates.length === 0 && stripped) {
      candidates = await searchReleaseGroups(artist, stripped);
      if (candidates.length > 0) searchTitle = stripped;
    }

    if (candidates.length === 0) {
      return { decision: "not_found", score: 0, top: null, detail: null, release: null, combinedGenres: [], combinedTags: [], error: null };
    }

    candidates = filterByTrackCount(candidates, trackCount);

    let ranked = rankCandidates(candidates, artist, searchTitle, year, confirmedArtistMbid);

    // The local title may carry a mix/edition suffix ("BRAT (Dolby Atmos Mix)")
    // that MB's search still returns hits for, just scored poorly against the
    // noisy full title. Retry with the bracket stripped and merge in anything
    // new whenever the first pass didn't land a confident match.
    if (stripped && stripped !== searchTitle && ranked[0]!.score < AUTO_CONFIRM_THRESHOLD) {
      const strippedCandidates = await searchReleaseGroups(artist, stripped);
      const seen = new Set(candidates.map((c) => c.id));
      const merged = candidates.concat(strippedCandidates.filter((c) => !seen.has(c.id)));
      const mergedFiltered = filterByTrackCount(merged, trackCount);
      const rankedByStripped = rankCandidates(mergedFiltered, artist, stripped, year, confirmedArtistMbid);
      if (rankedByStripped[0]!.score > ranked[0]!.score) {
        ranked = rankedByStripped;
        searchTitle = stripped;
      }
    }

    const top = ranked[0]!;
    const second = ranked[1];
    const gap = second ? top.score - second.score : Infinity;

    if (top.score < AUTO_CONFIRM_THRESHOLD || gap < MIN_SCORE_GAP) {
      const decision = top.score < AUTO_CONFIRM_THRESHOLD ? "needs_review" : "ambiguous";
      return { decision, score: top.score, top: top.candidate, detail: null, release: null, combinedGenres: [], combinedTags: [], error: null };
    }

    const rgDetail = await lookupReleaseGroup(top.candidate.id);

    // Prefer a dated release as the first guess (most likely the canonical
    // pressing), but a release group often bundles alternate editions (bonus
    // disc, live, reissue) with different tracklists under one dated entry.
    // If that guess's track count doesn't match, try a couple more releases
    // before concluding the release group itself needs manual review.
    const orderedReleaseIds = [
      rgDetail.releases.find((r) => r.date)?.id,
      ...rgDetail.releases.map((r) => r.id),
    ].filter((id, i, arr): id is string => id != null && arr.indexOf(id) === i);

    let releaseDetail: MbReleaseDetail | null = null;
    for (const candidateReleaseId of orderedReleaseIds.slice(0, 3)) {
      try {
        const detail = await lookupRelease(candidateReleaseId);
        releaseDetail = detail;
        if (trackCount <= 0 || !detail.trackCount || Math.abs(detail.trackCount - trackCount) <= 1) {
          break;
        }
      } catch {
        // Non-fatal: try the next release, or fall through with RG data alone
      }
    }

    const combinedGenres = combineGenres(rgDetail.genres, releaseDetail?.genres ?? []);
    const combinedTags = combineGenres(rgDetail.tags, releaseDetail?.tags ?? []);

    // Text similarity alone can't tell a correct match from a same-titled
    // deluxe/live/compilation edition with a different tracklist. Downgrade
    // to manual review when none of the releases tried above match (allows
    // for a bonus/hidden track without false-flagging).
    if (
      trackCount > 0 &&
      releaseDetail?.trackCount &&
      Math.abs(releaseDetail.trackCount - trackCount) > 1
    ) {
      return {
        decision: "needs_review",
        score: top.score,
        top: top.candidate,
        detail: rgDetail,
        release: releaseDetail,
        combinedGenres,
        combinedTags,
        error: null,
      };
    }

    return {
      decision: "auto_confirmed",
      score: top.score,
      top: top.candidate,
      detail: rgDetail,
      release: releaseDetail,
      combinedGenres,
      combinedTags,
      error: null,
    };
  } catch (e) {
    return {
      decision: "error",
      score: 0,
      top: null,
      detail: null,
      release: null,
      combinedGenres: [],
      combinedTags: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
