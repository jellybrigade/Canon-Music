import type { MbReleaseGroupCandidate } from "../../../clients/musicbrainz";
import { parseNumberOr } from "../../../lib/numberSetting";

const EDITION_NOISE = /\b(deluxe|remastered?|expanded|anniversary|edition|disc\s*\d+|\(?\d{4}\s+remaster\)?)\b/gi;
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

/** Drops one or more trailing bracketed groups: "The Suburbs (Deluxe Edition)" → "The Suburbs". */
export function stripTrailingBrackets(title: string): string | null {
  const stripped = title.replace(/\s*[([].*?[)\]]\s*$/, "").trim();
  return stripped !== title && stripped.length > 0 ? stripped : null;
}

function containsWholeWords(longer: string, shorter: string): boolean {
  return new RegExp(`(^|\\s)${shorter}(\\s|$)`).test(longer);
}

// A title inside a longer one ("Kid A" in "Kid A Mnesia") is a lead, not a match: score it by
// how much of the longer title it covers, so near misses spread out instead of tying.
const CONTAINMENT_FLOOR = 0.4;
const CONTAINMENT_SPAN = 0.5;
const MIN_TITLE_CONTAINMENT_LENGTH = 4;
// A local title equal to the release once a trailing "(...)" is dropped: likely the same
// release, but the suffix may name a different version, so short of an exact match.
const BRACKET_SUFFIX_MATCH = 0.95;

/** Title similarity, crediting whole-word containment by coverage and a dropped trailing bracket suffix. */
function titleSimilarity(query: string, candidate: string): number {
  const base = similarity(query, candidate);
  const nq = normalizeForMatch(query);
  const nc = normalizeForMatch(candidate);
  const strippedQuery = stripTrailingBrackets(query);
  const strippedCandidate = stripTrailingBrackets(candidate);
  if (
    (strippedQuery && normalizeForMatch(strippedQuery) === nc) ||
    (strippedCandidate && normalizeForMatch(strippedCandidate) === nq)
  ) {
    return Math.max(base, BRACKET_SUFFIX_MATCH);
  }
  const shorter = nq.length <= nc.length ? nq : nc;
  const longer = nq.length <= nc.length ? nc : nq;
  // Whole words only, so a short generic MB title ("Live", "Demo") can't ride on letters
  // that happen to sit inside an unrelated local title.
  if (shorter.length >= MIN_TITLE_CONTAINMENT_LENGTH && containsWholeWords(longer, shorter)) {
    return Math.max(base, CONTAINMENT_FLOOR + CONTAINMENT_SPAN * (shorter.length / longer.length));
  }
  return base;
}

// "Eno" inside "Brian Eno", "Queen" inside "Queen + Adam Lambert": strong, not certain.
const ARTIST_CONTAINMENT_SCORE = 0.9;

/** Artist similarity: exact credited members score 1 ("Filow & Ski Aggu" vs "Filow"), a whole-word name inside the credit less. */
function artistSimilarity(credit: string, query: string): number {
  const nc = normalizeForMatch(credit);
  const nq = normalizeForMatch(query);
  if (!nc || !nq) return 0;
  const splitRe = /\s*[&,+]\s*|\s+(?:feat|ft|featuring|vs|and|x)\.?\s+/i;
  let best = similarity(credit, query);
  for (const creditPart of credit.split(splitRe)) {
    for (const queryPart of query.split(splitRe)) {
      best = Math.max(best, similarity(creditPart, queryPart));
    }
  }
  const shorter = nq.length <= nc.length ? nq : nc;
  const longer = nq.length <= nc.length ? nc : nq;
  if (containsWholeWords(longer, shorter)) best = Math.max(best, ARTIST_CONTAINMENT_SCORE);
  return best;
}

/** Extract a 4-digit year from an MB date string ("2023-05-12" → 2023). */
function extractYear(date: string | null): number | null {
  return parseNumberOr(date?.match(/^\d{4}/)?.[0], null);
}

/** What is known locally about the album being identified. */
export interface LocalAlbum {
  artist: string;
  title: string;
  /** Local release year, disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere, replaces the artist-name comparison. */
  confirmedArtistMbid?: string | null;
  /** Zero or absent while unknown. */
  trackCount?: number;
  /** Total length; zero or absent while unknown. */
  durationSeconds?: number;
}

export type AlbumShape = Required<Pick<LocalAlbum, "trackCount" | "durationSeconds">>;

/** Track count and total length; the length is unknown (zero) if any track lacks one, a partial sum would read short. */
export function albumShapeOf(tracks: ReadonlyArray<{ duration: number | null }>): AlbumShape {
  const isLengthKnown = tracks.every((t) => t.duration !== null && t.duration > 0);
  return {
    trackCount: tracks.length,
    durationSeconds: isLengthKnown ? tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0) : 0,
  };
}

// A secondary type the local title doesn't name is a different release of the same music
// (a live recording, a best-of, a soundtrack). Types without a hint are never what a library holds.
const SECONDARY_TYPE_HINTS: Record<string, RegExp> = {
  Live: /\blive\b/,
  Compilation: /\b(greatest hits|best of|hits|collection|anthology|essentials?|singles|retrospective)\b/,
  Remix: /\b(remix(es|ed)?|rmx)\b/,
  Demo: /\bdemos?\b/,
  Soundtrack: /\b(soundtrack|ost|score|motion picture)\b/,
  "DJ-mix": /\b(dj[- ]?mix|mixed by|continuous mix)\b/,
  "Mixtape/Street": /\bmixtape\b/,
};
// Local titles naming these describe a different recording than a release without the type.
const DISTINCT_VERSION_TYPES = ["Live", "Remix", "Demo"];
const SECONDARY_TYPE_PENALTY = 0.15;

function secondaryTypePenalty(secondaryTypes: string[], localTitle: string): number {
  const title = stripDiacritics(localTitle).toLowerCase();
  const unasked = secondaryTypes.filter((type) => !SECONDARY_TYPE_HINTS[type]?.test(title));
  const missing = DISTINCT_VERSION_TYPES.filter(
    (type) => SECONDARY_TYPE_HINTS[type]?.test(title) === true && !secondaryTypes.includes(type),
  );
  return SECONDARY_TYPE_PENALTY * (unasked.length + missing.length);
}

// Store conventions (Apple, Spotify): singles run 1-3 tracks and EPs up to 6, both under 30 minutes.
const SINGLE_MAX_TRACKS = 3;
const EP_MAX_TRACKS = 6;
const SHORT_RELEASE_MAX_SECONDS = 30 * 60;
// Two or three tracks under this long are a single, not an album.
const SINGLE_SHAPED_MAX_SECONDS = 15 * 60;
const SHAPE_PENALTY = 0.3;

/** Whether a release type fits the local track count and length; unknown shapes and catch-all types always fit. */
function fitsShape(primaryType: string | null, { trackCount = 0, durationSeconds = 0 }: LocalAlbum): boolean {
  if (trackCount <= 0) return true;
  const isShortOrUnknown = durationSeconds <= 0 || durationSeconds < SHORT_RELEASE_MAX_SECONDS;
  switch (primaryType) {
    case "Single":
      return trackCount <= SINGLE_MAX_TRACKS && isShortOrUnknown;
    case "EP":
      return trackCount <= EP_MAX_TRACKS && isShortOrUnknown;
    case "Album":
      return !(trackCount <= SINGLE_MAX_TRACKS && durationSeconds > 0 && durationSeconds < SINGLE_SHAPED_MAX_SECONDS);
    default:
      return true;
  }
}

/**
 * Title 60%, artist 40%, then evidence about the release: `year` nudges up on a match and down on a
 * mismatch, a secondary type the title doesn't ask for and a type that doesn't fit the local track
 * count and length each dock it, so same-titled releases can't tie.
 */
export function scoreReleaseGroup(c: MbReleaseGroupCandidate, local: LocalAlbum): number {
  const artistScore =
    local.confirmedArtistMbid && c.artistMbid === local.confirmedArtistMbid
      ? 1.0
      : artistSimilarity(c.artistName, local.artist);

  const titleScore = titleSimilarity(local.title, c.title);
  let score = 0.6 * titleScore + 0.4 * artistScore;

  const candidateYear = extractYear(c.firstReleaseDate);
  if (local.year && candidateYear) {
    const diff = Math.abs(candidateYear - local.year);
    if (diff === 0) score += 0.05;
    // A near-exact title match is very likely the same release under a
    // reissue/remaster, the local tag year often reflects that reissue
    // rather than MB's original firstReleaseDate, so don't punish it.
    else if (diff > 1 && titleScore < 0.9) score -= 0.15;
  }

  score -= secondaryTypePenalty(c.secondaryTypes, local.title);
  if (!fitsShape(c.primaryType, local)) score -= SHAPE_PENALTY;

  return Math.max(0, Math.min(1, score));
}

export interface RankedCandidate {
  candidate: MbReleaseGroupCandidate;
  score: number;
}

const TYPE_RANK: Record<string, number> = { Album: 3, Other: 2, Broadcast: 2, EP: 1, Single: 0 };

/** Sort candidates descending by fuzzy score; prefer Album type and MB score as tiebreakers. */
export function rankCandidates(cands: MbReleaseGroupCandidate[], local: LocalAlbum): RankedCandidate[] {
  return cands
    .map((c) => ({ candidate: c, score: scoreReleaseGroup(c, local) }))
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      // Same fuzzy score, prefer Album over Single, then MB's own relevance score
      const typeA = TYPE_RANK[a.candidate.primaryType ?? ""] ?? 1;
      const typeB = TYPE_RANK[b.candidate.primaryType ?? ""] ?? 1;
      if (typeB !== typeA) return typeB - typeA;
      return (b.candidate.score ?? 0) - (a.candidate.score ?? 0);
    });
}

/**
 * The top candidate if it clears `minScore` and beats the runner-up by `minGap`, or shares its title
 * while outranking it by type: an album and its same-titled lead single score identically.
 */
export function pickClearWinner(
  ranked: RankedCandidate[],
  { minScore, minGap }: { minScore: number; minGap: number },
): RankedCandidate | null {
  const [top, second] = ranked;
  if (!top || top.score < minScore) return null;
  if (!second || top.score - second.score >= minGap) return top;
  const typeRank = (r: RankedCandidate) => TYPE_RANK[r.candidate.primaryType ?? ""] ?? 1;
  const isSameTitle = normalizeForMatch(top.candidate.title) === normalizeForMatch(second.candidate.title);
  return isSameTitle && typeRank(top) > typeRank(second) ? top : null;
}
