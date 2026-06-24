/**
 * Core MB auto-identify logic as a plain async function — no React hooks.
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

const AUTO_CONFIRM_THRESHOLD = 0.80;
const MIN_SCORE_GAP = 0.10;

export function stripTrailingBrackets(title: string): string | null {
  const stripped = title.replace(/\s*[\(\[].*?[\)\]]\s*$/, "").trim();
  return stripped !== title && stripped.length > 0 ? stripped : null;
}

export async function autoIdentifyAlbum({ artist, album, trackCount = 0 }: { artist: string; album: string; trackCount?: number }): Promise<AutoIdentifyResult> {
  try {
    let candidates = await searchReleaseGroups(artist, album);
    let searchTitle = album;

    if (candidates.length === 0) {
      const stripped = stripTrailingBrackets(album);
      if (stripped) {
        candidates = await searchReleaseGroups(artist, stripped);
        if (candidates.length > 0) searchTitle = stripped;
      }
    }

    if (candidates.length === 0) {
      return { decision: "not_found", score: 0, top: null, detail: null, release: null, combinedGenres: [], combinedTags: [], error: null };
    }

    candidates = filterByTrackCount(candidates, trackCount);

    const ranked = rankCandidates(candidates, artist, searchTitle);
    const top = ranked[0]!;
    const second = ranked[1];
    const gap = second ? top.score - second.score : Infinity;

    if (top.score < AUTO_CONFIRM_THRESHOLD || gap < MIN_SCORE_GAP) {
      const decision = top.score < AUTO_CONFIRM_THRESHOLD ? "needs_review" : "ambiguous";
      return { decision, score: top.score, top: top.candidate, detail: null, release: null, combinedGenres: [], combinedTags: [], error: null };
    }

    const rgDetail = await lookupReleaseGroup(top.candidate.id);

    const releaseId =
      rgDetail.releases.find((r) => r.date)?.id ??
      rgDetail.releases[0]?.id ??
      null;

    let releaseDetail: MbReleaseDetail | null = null;
    if (releaseId) {
      try {
        releaseDetail = await lookupRelease(releaseId);
      } catch {
        // Non-fatal: RG data alone is still useful
      }
    }

    const combinedGenres = combineGenres(rgDetail.genres, releaseDetail?.genres ?? []);
    const combinedTags = combineGenres(rgDetail.tags, releaseDetail?.tags ?? []);

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
