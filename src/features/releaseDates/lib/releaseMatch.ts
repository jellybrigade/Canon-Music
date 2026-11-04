import { normalizeForMatch, stripTrailingBrackets } from "../../enrichment/lib/fuzzyMatch";

export type ReleaseKind = "album" | "ep" | "single";

export interface LocalRelease {
  name: string;
  artist: string;
  year: number;
  kind: ReleaseKind;
  /** Tracks stored for the album; 0 when none are, which skips the count check. */
  trackCount: number;
}

/** A release a source lists; `recordType` is the source's word for its kind. */
export interface ReleaseCandidate {
  title: string;
  recordType: string;
  trackCount: number;
  artistName: string;
}

export interface DeezerAlbumHit extends ReleaseCandidate {
  id: number;
  artistId: number;
}

export interface Edition {
  releaseDate: string;
  label: string | null;
  recordType: string;
}

export interface DiscographyEntry {
  title: string;
  recordType: string;
  releaseDate: string;
}

export interface ReleaseDecision {
  releaseDate: string | null;
  label: string | null;
  recordType: string | null;
  isReissue: boolean;
}

// Live, compilation and soundtrack albums are albums on Deezer and iTunes too (Deezer applies `compile` loosely).
const LOCAL_KINDS: Record<string, ReleaseKind> = {
  album: "album",
  live: "album",
  compilation: "album",
  soundtrack: "album",
  ep: "ep",
  single: "single",
};
const SOURCE_KINDS: Record<string, ReleaseKind> = { album: "album", compile: "album", ep: "ep", single: "single" };
const SINGLE_MAX_TRACKS = 3;
const EP_MAX_TRACKS = 6;
const TRACK_COUNT_TOLERANCE = 2;
// Deezer dates are edition dates and a December release is often tagged with the next year, so an
// edition counts as earlier only when it came out before the middle of the year before.
const EARLIER_EDITION_CUTOFF = "-07-01";

export function localReleaseKind(releaseType: string | null, trackCount: number): ReleaseKind | null {
  const known = releaseType === null ? undefined : LOCAL_KINDS[releaseType.trim().toLowerCase()];
  if (known !== undefined) return known;
  if (trackCount === 0) return null;
  if (trackCount <= SINGLE_MAX_TRACKS) return "single";
  if (trackCount <= EP_MAX_TRACKS) return "ep";
  return "album";
}

// Stricter than `normalizeForMatch`: "P.I.S.S." is another band than "PISS", and "(Remastered)"
// is another edition, so punctuation and edition words stay. Only case, accents, quote styles,
// spacing and a featured-artist credit are ignored.
function strictKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/g, "")
    .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function leadArtist(key: string): string {
  return key.split(/\s+&\s+/)[0] ?? key;
}

export function isSameArtist(local: string, remote: string): boolean {
  const localKey = strictKey(local);
  const remoteKey = strictKey(remote);
  return localKey === remoteKey || leadArtist(localKey) === leadArtist(remoteKey);
}

function isSameKind(kind: ReleaseKind, recordType: string): boolean {
  return SOURCE_KINDS[recordType.toLowerCase()] === kind;
}

export function isMatchingRelease(album: LocalRelease, hit: ReleaseCandidate): boolean {
  return (
    isSameArtist(album.artist, hit.artistName) &&
    strictKey(album.name) === strictKey(hit.title) &&
    isSameKind(album.kind, hit.recordType) &&
    (album.trackCount === 0 || Math.abs(album.trackCount - hit.trackCount) <= TRACK_COUNT_TOLERANCE)
  );
}

/** A real `YYYY-MM-DD` no later than `latestAllowed`; Deezer sends `0000-00-00` for unknown. */
export function isValidReleaseDate(date: string, latestAllowed: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return false;
  const [, yearText = "", monthText = "", dayText = ""] = match;
  const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDay =
    year > 0 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  return isRealDay && date <= latestAllowed;
}

function baseTitleKey(title: string): string {
  return normalizeForMatch(stripTrailingBrackets(title) ?? title);
}

function isEarlierEdition(date: string, year: number): boolean {
  return date < `${year - 1}${EARLIER_EDITION_CUTOFF}`;
}

/**
 * The earliest valid date across the matching editions, and whether the album is a later edition
 * of older music: one of its own editions, or a same-kind release of the artist under the same
 * title without its brackets, came out well before the album's year.
 */
export function decideRelease(
  album: LocalRelease,
  editions: readonly Edition[],
  discography: readonly DiscographyEntry[],
  latestAllowed: string,
): ReleaseDecision {
  const dated = editions
    .filter((edition) => isValidReleaseDate(edition.releaseDate, latestAllowed))
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  const earliest = dated[0];
  const baseTitle = baseTitleKey(album.name);
  const isEarlierRelease = discography.some(
    (entry) =>
      isSameKind(album.kind, entry.recordType) &&
      baseTitleKey(entry.title) === baseTitle &&
      isValidReleaseDate(entry.releaseDate, latestAllowed) &&
      isEarlierEdition(entry.releaseDate, album.year),
  );
  return {
    releaseDate: earliest?.releaseDate ?? null,
    label: earliest?.label ?? null,
    recordType: earliest?.recordType ?? null,
    isReissue: isEarlierRelease || (earliest !== undefined && isEarlierEdition(earliest.releaseDate, album.year)),
  };
}
