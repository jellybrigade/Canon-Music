/**
 * Fuzzy string matching for MusicBrainz candidate scoring.
 * Dependency-free: inline Levenshtein + string normalization.
 */
import type { MbReleaseGroupCandidate } from "./musicbrainz";

const EDITION_NOISE =
  /\b(deluxe|remastered?|expanded|anniversary|edition|disc\s*\d+|\(?\d{4}\s+remaster\)?)\b/gi;
const LEADING_ARTICLES = /^(the|a|an)\s+/i;
// Combining diacritical marks range (after NFD decomposition)
const COMBINING_MARKS = /[̀-ͯ]/g;

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Lowercase, strip diacritics, drop edition noise, drop leading articles, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(EDITION_NOISE, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(LEADING_ARTICLES, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized Levenshtein similarity: 0 (completely different) → 1 (identical). */
export function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const la = na.length;
  const lb = nb.length;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const curr = new Array<number>(lb + 1);
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return 1 - prev[lb]! / Math.max(la, lb);
}

/**
 * Artist similarity that handles collaborative credits.
 * "Filow & Ski Aggu" vs "Filow" → 1.0 because one contains the other.
 * Also splits on feat/ft/& and takes the best component match.
 */
function artistSimilarity(a: string, b: string): number {
  const base = similarity(a, b);
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na.includes(nb) || nb.includes(na)) return 1.0;
  // Split on collaboration separators and take best partial match
  const splitRe = /\s*[&,]\s*|\s+(?:feat|ft|featuring|vs|and)\s+/i;
  const partsA = a.split(splitRe);
  const partsB = b.split(splitRe);
  let best = base;
  for (const pa of partsA) {
    for (const pb of partsB) {
      best = Math.max(best, similarity(pa, pb));
    }
  }
  return best;
}

/**
 * Title similarity with containment boost.
 * "Twin Peaks" inside "Soundtrack From Twin Peaks" scores 0.75 instead of ~0.38.
 * Prevents exact-match penalty when album is part of a longer title.
 */
function titleSimilarity(query: string, candidate: string): number {
  const base = similarity(query, candidate);
  const nq = normalizeForMatch(query);
  const nc = normalizeForMatch(candidate);
  if (nq.length >= 4 && nc.includes(nq)) return Math.max(base, 0.75);
  return base;
}

/** Extract a 4-digit year from an MB date string ("2023-05-12" → 2023). */
function extractYear(date: string | null): number | null {
  if (!date) return null;
  const m = /^\d{4}/.exec(date);
  return m ? Number(m[0]) : null;
}

/**
 * Score a release group candidate against query artist + album strings.
 * Title weighted 60%, artist weighted 40% (title match matters more).
 *
 * Two optional disambiguators layer on top of the base text score:
 * - `knownYear`: local release year. Exact/near match nudges the score up;
 *   a real mismatch (same title, different year, two distinct releases
 *   both titled e.g. "Sisterhood") pulls it down so it can't tie a wrong
 *   candidate with the right one.
 * - `confirmedArtistMbid`: an MBID already confirmed for this artist via
 *   another album or the artist-identify dialog. A candidate whose artist
 *   credit matches it is almost certainly correct regardless of text
 *   similarity noise, so it overrides the artist-name component entirely.
 */
export function scoreReleaseGroup(
  c: MbReleaseGroupCandidate,
  artist: string,
  album: string,
  knownYear?: number | null,
  confirmedArtistMbid?: string | null
): number {
  const artistScore =
    confirmedArtistMbid && c.artistMbid === confirmedArtistMbid
      ? 1.0
      : artistSimilarity(c.artistName, artist);

  const titleScore = titleSimilarity(album, c.title);
  let score = 0.6 * titleScore + 0.4 * artistScore;

  const candidateYear = extractYear(c.firstReleaseDate);
  if (knownYear && candidateYear) {
    const diff = Math.abs(candidateYear - knownYear);
    if (diff === 0) score += 0.05;
    // A near-exact title match is very likely the same release under a
    // reissue/remaster, the local tag year often reflects that reissue
    // rather than MB's original firstReleaseDate, so don't punish it.
    else if (diff > 1 && titleScore < 0.9) score -= 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Filter candidates to types compatible with the known track count.
 * Falls back to unfiltered if filtering wipes everything out.
 */
export function filterByTrackCount(
  candidates: MbReleaseGroupCandidate[],
  trackCount: number
): MbReleaseGroupCandidate[] {
  if (trackCount <= 0) return candidates;

  const allowed = new Set<string>();
  if (trackCount <= 3) {
    allowed.add("Single");
    allowed.add("Album");
  } else if (trackCount <= 6) {
    allowed.add("EP");
    allowed.add("Album");
  } else {
    allowed.add("Album");
    allowed.add("Broadcast");
    allowed.add("Other");
  }

  const filtered = candidates.filter(
    (c) => c.primaryType === null || allowed.has(c.primaryType)
  );
  return filtered.length > 0 ? filtered : candidates;
}

export interface RankedCandidate {
  candidate: MbReleaseGroupCandidate;
  score: number;
}

const TYPE_RANK: Record<string, number> = { Album: 3, Other: 2, Broadcast: 2, EP: 1, Single: 0 };

/** Sort candidates descending by fuzzy score; prefer Album type and MB score as tiebreakers. */
export function rankCandidates(
  cands: MbReleaseGroupCandidate[],
  artist: string,
  album: string,
  knownYear?: number | null,
  confirmedArtistMbid?: string | null
): RankedCandidate[] {
  return cands
    .map((c) => ({
      candidate: c,
      score: scoreReleaseGroup(c, artist, album, knownYear, confirmedArtistMbid),
    }))
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      // Same fuzzy score, prefer Album over Single, then MB's own relevance score
      const typeA = TYPE_RANK[a.candidate.primaryType ?? ""] ?? 1;
      const typeB = TYPE_RANK[b.candidate.primaryType ?? ""] ?? 1;
      if (typeB !== typeA) return typeB - typeA;
      return (b.candidate.score ?? 0) - (a.candidate.score ?? 0);
    });
}
