import { normalizeForMatch, stripTrailingBrackets } from "../features/enrichment/lib/fuzzyMatch";
import { cappedSet } from "../lib/boundedCache";
import { boundedFetch } from "./boundedFetch";

const MAX_CACHE_ENTRIES = 2000;
const SEARCH_LIMIT = 5;
const cache = new Map<string, string | null>();

function setCached(key: string, value: string | null): void {
  cappedSet(cache, key, value, MAX_CACHE_ENTRIES);
}

function albumKey(title: string): string {
  const withoutType = title.replace(/\s+-\s+(single|ep)$/i, "");
  return normalizeForMatch(stripTrailingBrackets(withoutType) ?? withoutType);
}

// iTunes ranks by search relevance, so its top hit can be another artist or album entirely.
function isSameAlbum(hit: Record<string, unknown>, artist: string, album: string): boolean {
  return (
    typeof hit.artistName === "string" &&
    typeof hit.collectionName === "string" &&
    normalizeForMatch(hit.artistName) === normalizeForMatch(artist) &&
    albumKey(hit.collectionName) === albumKey(album)
  );
}

/** Resolves null when iTunes answered without a cover; rejects when it didn't answer, so nothing is cached. */
export async function fetchItunesCoverArt(artist: string | null, album: string | null): Promise<string | null> {
  if (!artist || !album) return null;
  const key = `${artist}\x00${album}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const term = encodeURIComponent(`${artist} ${album}`);
  const res = await boundedFetch(
    `https://itunes.apple.com/search?term=${term}&entity=album&limit=${SEARCH_LIMIT}&media=music`,
  );
  if (!res.ok) throw new Error(`iTunes returned ${res.status}`);
  const data: unknown = await res.json();
  const results =
    typeof data === "object" && data !== null && "results" in data && Array.isArray(data.results) ? data.results : [];
  const hit = results.find(
    (result): result is Record<string, unknown> =>
      typeof result === "object" && result !== null && isSameAlbum(result, artist, album),
  );
  const raw = hit?.artworkUrl100;
  const url = typeof raw === "string" && raw.startsWith("https://") ? raw.replace("100x100bb", "600x600bb") : null;
  setCached(key, url);
  return url;
}
