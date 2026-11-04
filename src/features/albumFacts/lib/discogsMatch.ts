import {
  isMatchingRelease,
  isSameArtist,
  isSameTitle,
  type LocalRelease,
  type ReleaseKind,
} from "../../releaseDates/lib/releaseMatch";

/** One row of Discogs' release search, its "Artist - Title" already split. */
export interface DiscogsSearchHit {
  id: number;
  masterId: number | null;
  artistName: string;
  title: string;
  year: number | null;
}

export interface DiscogsRelease {
  id: number;
  artistNames: string[];
  title: string;
  labels: { name: string; catalogNumber: string }[];
  country: string | null;
  styles: string[];
  genres: string[];
  trackCount: number;
  /** Format words such as "Album", "LP", "Single". */
  formatDescriptions: string[];
}

export type DiscogsTarget = { kind: "master" | "release"; id: number };

export interface DiscogsFacts {
  label: string | null;
  catalogNumber: string | null;
  country: string | null;
  styles: string[];
  genres: string[];
}

const KIND_WORDS: [string, ReleaseKind][] = [
  ["single", "single"],
  ["ep", "ep"],
  ["album", "album"],
];
const NOT_ON_LABEL = /^not on label\b/i;
const NO_CATALOG_NUMBER = new Set(["", "none"]);
const UNKNOWN_COUNTRY = new Set(["", "unknown"]);

/** Discogs tells same-named artists and labels apart with " (16)", and marks a name variation with "*". */
export function discogsName(name: string): string {
  return name
    .replace(/\s\(\d+\)$/, "")
    .replace(/\*$/, "")
    .trim();
}

function isNamedHit(album: Pick<LocalRelease, "name" | "artist">, hit: DiscogsSearchHit): boolean {
  return isSameArtist(album.artist, discogsName(hit.artistName)) && isSameTitle(album.name, hit.title);
}

/**
 * What to read for the album: the master most of its matching pressings belong to (its main
 * release is Discogs' own pick of the original), else the earliest matching release.
 */
export function pickDiscogsTarget(
  album: Pick<LocalRelease, "name" | "artist">,
  hits: readonly DiscogsSearchHit[],
): DiscogsTarget | null {
  const named = hits.filter((hit) => isNamedHit(album, hit));
  const pressingsPerMaster = new Map<number, number>();
  for (const { masterId } of named) {
    if (masterId !== null) pressingsPerMaster.set(masterId, (pressingsPerMaster.get(masterId) ?? 0) + 1);
  }
  const [master] = [...pressingsPerMaster].sort(([idA, countA], [idB, countB]) => countB - countA || idA - idB);
  if (master !== undefined) return { kind: "master", id: master[0] };
  const [earliest] = [...named].sort(
    (a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY) || a.id - b.id,
  );
  return earliest === undefined ? null : { kind: "release", id: earliest.id };
}

function releaseKind(formatDescriptions: readonly string[]): ReleaseKind | null {
  const words = new Set(formatDescriptions.map((word) => word.toLowerCase()));
  return KIND_WORDS.find(([word]) => words.has(word))?.[1] ?? null;
}

/** The release is the album: same lead artist and title, same kind when Discogs names one, about as many tracks. */
export function isFittingRelease(
  album: Pick<LocalRelease, "name" | "artist" | "kind" | "trackCount">,
  release: DiscogsRelease,
): boolean {
  return isMatchingRelease(album, {
    title: release.title,
    artistName: discogsName(release.artistNames[0] ?? ""),
    recordType: releaseKind(release.formatDescriptions) ?? album.kind,
    trackCount: release.trackCount,
  });
}

export function discogsFacts(release: DiscogsRelease): DiscogsFacts {
  const first = release.labels[0];
  const isSelfReleased = first !== undefined && NOT_ON_LABEL.test(first.name);
  const catalogNumber = first?.catalogNumber.trim() ?? "";
  const country = release.country?.trim() ?? "";
  return {
    label: first === undefined ? null : isSelfReleased ? "Self-released" : discogsName(first.name),
    catalogNumber: isSelfReleased || NO_CATALOG_NUMBER.has(catalogNumber.toLowerCase()) ? null : catalogNumber,
    country: UNKNOWN_COUNTRY.has(country.toLowerCase()) ? null : country,
    styles: release.styles,
    genres: release.genres,
  };
}
