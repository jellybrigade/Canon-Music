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
 * Score a release group candidate against query artist + album strings.
 * Title weighted 60%, artist weighted 40% (title match matters more).
 */
export function scoreReleaseGroup(
  c: MbReleaseGroupCandidate,
  artist: string,
  album: string
): number {
  return 0.6 * similarity(c.title, album) + 0.4 * artistSimilarity(c.artistName, artist);
}

export interface RankedCandidate {
  candidate: MbReleaseGroupCandidate;
  score: number;
}

/** Sort candidates descending by our fuzzy score (highest confidence first). */
export function rankCandidates(
  cands: MbReleaseGroupCandidate[],
  artist: string,
  album: string
): RankedCandidate[] {
  return cands
    .map((c) => ({ candidate: c, score: scoreReleaseGroup(c, artist, album) }))
    .sort((a, b) => b.score - a.score);
}
