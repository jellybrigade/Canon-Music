import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

interface TheAudioDbArtist {
  strBiographyEN?: string;
  strArtistThumb?: string;
}

interface TheAudioDbResponse {
  artists: TheAudioDbArtist[] | null;
}

async function searchTheAudioDb(name: string): Promise<TheAudioDbArtist | null> {
  const res = await tauriFetch(
    `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(name)}`,
    { method: "GET", connectTimeout: 8000, headers: { "User-Agent": "Canon Music Player" } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as TheAudioDbResponse;
  return data?.artists?.[0] ?? null;
}

export async function fetchTheAudioDbArtist(
  name: string
): Promise<{ bio: string | null; thumbUrl: string | null }> {
  let artist = await searchTheAudioDb(name);
  // Strip leading "The " if no result
  if (!artist && name.toLowerCase().startsWith("the ")) {
    artist = await searchTheAudioDb(name.slice(4));
  }
  return {
    bio: artist?.strBiographyEN?.trim() || null,
    thumbUrl: artist?.strArtistThumb?.trim() || null,
  };
}

export async function fetchWikipediaBio(name: string): Promise<string | null> {
  try {
    const res = await tauriFetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
      { method: "GET", connectTimeout: 8000, headers: { "User-Agent": "Canon Music Player" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { extract?: string };
    return data?.extract?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Fetch Wikipedia bio for an artist via MusicBrainz ID → Wikidata sitelink.
 * More reliable than name lookup for artists with common/ambiguous names (e.g. "Ye").
 */
export async function fetchWikipediaBioByMbid(mbid: string): Promise<string | null> {
  try {
    const sparql = `SELECT ?article WHERE { ?item wdt:P434 "${mbid}" . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`;
    const body = new URLSearchParams({ query: sparql, format: "json" }).toString();
    const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const work = tauriFetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "User-Agent": "Canon Music Player",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/sparql-results+json",
      },
      body,
    }).then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: { bindings?: Array<{ article?: { value: string } }> } };
      const articleUrl = data.results?.bindings?.[0]?.article?.value;
      if (!articleUrl) return null;
      const wikiTitle = decodeURIComponent(articleUrl.split("/wiki/")[1] ?? "").replace(/#.*$/, "").replace(/\?.*$/, "");
      if (!wikiTitle) return null;
      const summaryRes = await tauriFetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`,
        { method: "GET", connectTimeout: 8000, headers: { "User-Agent": "Canon Music Player" } }
      );
      if (!summaryRes.ok) return null;
      const summaryData = (await summaryRes.json()) as { extract?: string };
      return summaryData?.extract?.trim() || null;
    }).catch(() => null);
    return await Promise.race([work, deadline]);
  } catch {
    return null;
  }
}
