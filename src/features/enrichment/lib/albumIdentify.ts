import {
  combineGenres,
  lookupRelease,
  lookupReleaseGroup,
  type MbGenre,
  type MbReleaseDetail,
  type MbReleaseGroupCandidate,
  type MbReleaseGroupDetail,
  MusicBrainzError,
  searchReleaseGroups,
} from "../../../clients/musicbrainz";
import { errorMessage } from "../../../lib/errorMessage";
import {
  type LocalAlbum,
  pickClearWinner,
  type RankedCandidate,
  rankCandidates,
  stripTrailingBrackets,
} from "./fuzzyMatch";

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

// MusicBrainz doesn't know the id (stale, merged or malformed tag); anything else is a failed lookup, not an answer.
function isUnknownId(e: unknown): boolean {
  return e instanceof MusicBrainzError && (e.status === 404 || e.status === 400);
}

export interface TaggedRelease {
  release: MbReleaseDetail;
  detail: MbReleaseGroupDetail;
}

/** The release the files are tagged with and its group; `null` when MusicBrainz doesn't know it. */
export async function lookupTaggedRelease(releaseMbid: string): Promise<TaggedRelease | null> {
  try {
    const release = await lookupRelease(releaseMbid);
    if (!release.releaseGroupId) return null;
    return { release, detail: await lookupReleaseGroup(release.releaseGroupId) };
  } catch (e) {
    if (isUnknownId(e)) return null;
    throw e;
  }
}

/**
 * MusicBrainz search ranked against the local album, shared by album open and Identify. Mix/edition
 * suffixes ("BRAT (Dolby Atmos Mix)") can hide the plain release, so a top score under `confidentScore`
 * searches without them too.
 */
export async function searchRankedReleaseGroups(local: LocalAlbum, confidentScore: number): Promise<RankedCandidate[]> {
  const candidates = await searchReleaseGroups(local.artist, local.title);
  const ranked = rankCandidates(candidates, local);
  const stripped = stripTrailingBrackets(local.title);
  if (!stripped || (ranked[0]?.score ?? 0) >= confidentScore) return ranked;
  const seen = new Set(candidates.map((c) => c.id));
  const strippedCandidates = await searchReleaseGroups(local.artist, stripped);
  return rankCandidates(candidates.concat(strippedCandidates.filter((c) => !seen.has(c.id))), local);
}

export function autoIdentifyFailure(e: unknown): AutoIdentifyResult {
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
  try {
    const tagged = taggedReleaseMbid ? await lookupTaggedRelease(taggedReleaseMbid) : null;
    if (tagged) {
      return {
        decision: "auto_confirmed",
        score: 1,
        top: null,
        detail: tagged.detail,
        release: tagged.release,
        combinedGenres: combineGenres(tagged.detail.genres, tagged.release.genres),
        combinedTags: combineGenres(tagged.detail.tags, tagged.release.tags),
        error: null,
      };
    }

    const local: LocalAlbum = { artist, title: album, year, confirmedArtistMbid, trackCount, durationSeconds };
    const ranked = await searchRankedReleaseGroups(local, AUTO_CONFIRM_THRESHOLD);

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
    return autoIdentifyFailure(e);
  }
}
