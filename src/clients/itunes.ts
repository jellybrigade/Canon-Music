import { cappedSet } from "../lib/boundedCache";
import { boundedFetch } from "./boundedFetch";

const MAX_CACHE_ENTRIES = 2000;
const cache = new Map<string, string | null>();

function setCached(key: string, value: string | null): void {
  cappedSet(cache, key, value, MAX_CACHE_ENTRIES);
}

/** Resolves null when iTunes answered without a cover; rejects when it didn't answer, so nothing is cached. */
export async function fetchItunesCoverArt(artist: string | null, album: string | null): Promise<string | null> {
  if (!artist || !album) return null;
  const key = `${artist}\x00${album}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const term = encodeURIComponent(`${artist} ${album}`);
  const res = await boundedFetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1&media=music`);
  if (!res.ok) throw new Error(`iTunes returned ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ artworkUrl100?: string }> };
  const raw = data.results?.[0]?.artworkUrl100 ?? null;
  const url = raw ? raw.replace("100x100bb", "600x600bb") : null;
  setCached(key, url);
  return url;
}
