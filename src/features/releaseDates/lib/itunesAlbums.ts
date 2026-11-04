import type { ReleaseCandidate, ReleaseKind } from "./releaseMatch";

export interface ItunesAlbum extends ReleaseCandidate {
  recordType: ReleaseKind;
  /** The day iTunes names, `YYYY-MM-DD`. */
  releaseDate: string;
  /** iTunes' 100px artwork, https only. */
  artworkUrl: string | null;
}

const KIND_SUFFIX = /\s+-\s+(single|ep)$/i;
const SUFFIX_KINDS: Record<string, ReleaseKind> = { single: "single", ep: "ep" };
// iTunes stamps midnight Pacific in UTC, so the date part is the day it names; local time would shift it.
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})T/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One release from an iTunes artist lookup, its kind read from the ` - Single` / ` - EP` suffix; null otherwise. */
export function parseItunesCollection(raw: unknown): ItunesAlbum | null {
  if (!isObject(raw)) return null;
  const { wrapperType, collectionName, artistName, trackCount, releaseDate, artworkUrl100 } = raw;
  if (wrapperType !== "collection" || typeof collectionName !== "string" || typeof artistName !== "string") return null;
  if (typeof trackCount !== "number" || typeof releaseDate !== "string") return null;
  const day = ISO_DAY.exec(releaseDate)?.[1];
  if (day === undefined) return null;
  const suffix = KIND_SUFFIX.exec(collectionName)?.[1]?.toLowerCase() ?? "";
  const recordType = SUFFIX_KINDS[suffix] ?? "album";
  const artworkUrl = typeof artworkUrl100 === "string" && artworkUrl100.startsWith("https://") ? artworkUrl100 : null;
  return {
    title: collectionName.replace(KIND_SUFFIX, ""),
    recordType,
    trackCount,
    artistName,
    releaseDate: day,
    artworkUrl,
  };
}
