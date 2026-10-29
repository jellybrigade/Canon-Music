import { boundedNativeFetch } from "./boundedFetch";

const CAA_BASE = "https://coverartarchive.org";
const USER_AGENT = "Canon Music Player";
// Scans of the disc's matrix area, untouched scans and watermarked previews are not a cover anyone wants shown.
const UNUSABLE_TYPES = new Set(["Matrix/Runout", "Raw/Unedited", "Watermark"]);

export interface CaaCover {
  originalUrl: string;
  thumbUrl: string;
  fullUrl: string;
  isApproved: boolean;
}

interface CaaImage {
  types?: unknown;
  approved?: unknown;
  image?: unknown;
  thumbnails?: Record<string, unknown>;
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

function toCover(entry: CaaImage): CaaCover | null {
  const types = Array.isArray(entry.types) ? entry.types.filter((t): t is string => typeof t === "string") : [];
  // `includes`, not equality: a front that is also a booklet page is still the front.
  if (!types.includes("Front") || types.some((type) => UNUSABLE_TYPES.has(type))) return null;
  const original = firstString(entry.image);
  if (original === null) return null;
  const thumbs = entry.thumbnails ?? {};
  return {
    originalUrl: original,
    thumbUrl: firstString(thumbs["250"], thumbs.small, thumbs["500"], thumbs.large) ?? original,
    // The 1200 rendition, not the original: originals reach thousands of pixels and tens of megabytes.
    fullUrl: firstString(thumbs["1200"], thumbs["500"], thumbs.large) ?? original,
    isApproved: entry.approved === true,
  };
}

/** Front covers the Cover Art Archive holds for a release or release group; empty when it has none,
 * rejects when it didn't answer. */
export async function fetchCaaFrontCovers(kind: "release" | "release-group", mbid: string): Promise<CaaCover[]> {
  const res = await boundedNativeFetch(`${CAA_BASE}/${kind}/${encodeURIComponent(mbid)}`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Cover Art Archive returned ${res.status}`);
  const data: unknown = await res.json();
  const images =
    typeof data === "object" && data !== null && "images" in data && Array.isArray(data.images) ? data.images : [];
  return images
    .filter((entry): entry is CaaImage => typeof entry === "object" && entry !== null)
    .map(toCover)
    .filter((cover): cover is CaaCover => cover !== null);
}
