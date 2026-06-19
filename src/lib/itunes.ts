const cache = new Map<string, string | null>();

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
    if (!res.ok) { cache.set(key, null); return null; }
    const data = (await res.json()) as { results?: Array<{ artworkUrl100?: string }> };
    const raw = data.results?.[0]?.artworkUrl100 ?? null;
    const url = raw ? raw.replace("100x100bb", "600x600bb") : null;
    cache.set(key, url);
    return url;
  } catch {
    cache.set(key, null);
    return null;
  }
}
