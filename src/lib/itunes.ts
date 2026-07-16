const MAX_CACHE_ENTRIES = 2000;
const cache = new Map<string, string | null>();

function setCached(key: string, value: string | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}

export async function fetchItunesCoverArt(
  artist: string | null,
  album: string | null
): Promise<string | null> {
  if (!artist || !album) return null;
  const key = `${artist}\x00${album}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const term = encodeURIComponent(`${artist} ${album}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=album&limit=1&media=music`
    );
    if (!res.ok) { setCached(key, null); return null; }
    const data = (await res.json()) as { results?: Array<{ artworkUrl100?: string }> };
    const raw = data.results?.[0]?.artworkUrl100 ?? null;
    const url = raw ? raw.replace("100x100bb", "600x600bb") : null;
    setCached(key, url);
    return url;
  } catch {
    setCached(key, null);
    return null;
  }
}
