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
import { errorMessage } from "../../../lib/errorMessage";
import { type LocalAlbum, pickClearWinner, rankCandidates, stripTrailingBrackets } from "./fuzzyMatch";

export type AutoDecision = "auto_confirmed" | "not_found" | "ambiguous" | "needs_review" | "error";

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

const AUTO_CONFIRM_THRESHOLD = 0.9;
const MIN_SCORE_GAP = 0.1;
export const AUTO_IDENTIFY_RETRY_SECONDS = 7 * 24 * 60 * 60;

/** Never looked up, or an automatic lookup that found nothing long enough ago that MusicBrainz may have it now. */
export function needsAutoIdentify(
  identity: { mb_release_group_id: string | null; confirmed_at: number | null; looked_up_at: number | null } | null,
  nowSeconds: number,
): boolean {
  if (identity === null) return true;
  if (identity.mb_release_group_id !== null || identity.confirmed_at !== null) return false;
  return nowSeconds - (identity.looked_up_at ?? 0) >= AUTO_IDENTIFY_RETRY_SECONDS;
}

/** The release the files are tagged with, confirmed outright; `null` when MusicBrainz can't resolve it. */
async function identifyTaggedRelease(releaseMbid: string): Promise<AutoIdentifyResult | null> {
  try {
    const release = await lookupRelease(releaseMbid);
    if (!release.releaseGroupId) return null;
    const detail = await lookupReleaseGroup(release.releaseGroupId);
    return {
      decision: "auto_confirmed",
      score: 1,
      top: null,
      detail,
      release,
      combinedGenres: combineGenres(detail.genres, release.genres),
      combinedTags: combineGenres(detail.tags, release.tags),
      error: null,
    };
  } catch {
    // A stale or merged id: the search below still has a chance.
    return null;
  }
}

export async function autoIdentifyAlbum({
  artist,
  album,
  trackCount = 0,
  durationSeconds = 0,
  year = null,
  confirmedArtistMbid = null,
  taggedReleaseMbid = null,
}: {
  artist: string;
  album: string;
  trackCount?: number;
  /** Total local length, tells an album from its same-titled single. */
  durationSeconds?: number;
  /** Known local release year, disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere, disambiguates same-titled releases by different artists. */
  confirmedArtistMbid?: string | null;
  /** MusicBrainz release from the files' tags (Picard), taken over any search. */
  taggedReleaseMbid?: string | null;
}): Promise<AutoIdentifyResult> {
  if (taggedReleaseMbid) {
    const tagged = await identifyTaggedRelease(taggedReleaseMbid);
    if (tagged) return tagged;
  }
  try {
    let candidates = await searchReleaseGroups(artist, album);
    const local: LocalAlbum = { artist, title: album, year, confirmedArtistMbid, trackCount, durationSeconds };
    let ranked = rankCandidates(candidates, local);

    // Mix/edition suffixes ("BRAT (Dolby Atmos Mix)") can hide the plain release from MB's
    // search; search without them too when the first pass found nothing confident.
    const stripped = stripTrailingBrackets(album);
    if (stripped && (ranked[0]?.score ?? 0) < AUTO_CONFIRM_THRESHOLD) {
      const seen = new Set(candidates.map((c) => c.id));
      const strippedCandidates = await searchReleaseGroups(artist, stripped);
      candidates = candidates.concat(strippedCandidates.filter((c) => !seen.has(c.id)));
      ranked = rankCandidates(candidates, local);
    }

    const top = ranked[0];
    if (!top) {
      return {
        decision: "not_found",
        score: 0,
        top: null,
        detail: null,
        release: null,
        combinedGenres: [],
        combinedTags: [],
        error: null,
      };
    }

    if (!pickClearWinner(ranked, { minScore: AUTO_CONFIRM_THRESHOLD, minGap: MIN_SCORE_GAP })) {
      return {
        decision: top.score < AUTO_CONFIRM_THRESHOLD ? "needs_review" : "ambiguous",
        score: top.score,
        top: top.candidate,
        detail: null,
        release: null,
        combinedGenres: [],
        combinedTags: [],
        error: null,
      };
    }

    const rgDetail = await lookupReleaseGroup(top.candidate.id);

    // Dated release is the likely canonical pressing, but bonus/live/reissue editions
    // share the same dated entry with different tracklists; try a couple more on mismatch.
    const orderedReleaseIds = [rgDetail.releases.find((r) => r.date)?.id, ...rgDetail.releases.map((r) => r.id)].filter(
      (id, i, arr): id is string => id != null && arr.indexOf(id) === i,
    );

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

    // Title similarity can't distinguish a same-titled deluxe/live edition;
    // downgrade to manual review if no tried release's track count matches.
    if (trackCount > 0 && releaseDetail?.trackCount && Math.abs(releaseDetail.trackCount - trackCount) > 1) {
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
      error: errorMessage(e),
    };
  }
}
