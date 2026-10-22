import { normalizeForMatch } from "../features/enrichment/lib/fuzzyMatch";
import { isMbid } from "../lib/mbid";
import { boundedNativeFetch } from "./boundedFetch";

interface TheAudioDbArtist {
  strArtist?: string;
  strBiographyEN?: string;
  strArtistThumb?: string;
}

interface TheAudioDbResponse {
  artists: TheAudioDbArtist[] | null;
}

interface WikipediaSummary {
  type?: string;
  extract?: string;
}

/** Rejects when TheAudioDB didn't answer, so a missing portrait isn't taken as "there is none". */
async function searchTheAudioDb(name: string): Promise<TheAudioDbArtist | null> {
  const res = await boundedNativeFetch(
    `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(name)}`,
    {
      method: "GET",
      headers: { "User-Agent": "Canon Music Player" },
    },
  );
  if (!res.ok) throw new Error(`TheAudioDB returned ${res.status}`);
  const data = (await res.json()) as TheAudioDbResponse;
  const wanted = normalizeForMatch(name);
  // The search matches loosely, so its first hit can be a different artist.
  return (
    data?.artists?.find(
      (artist) => typeof artist.strArtist === "string" && normalizeForMatch(artist.strArtist) === wanted,
    ) ?? null
  );
}

function biographyFrom(summary: WikipediaSummary): string | null {
  if (summary.type === "disambiguation") return null;
  return typeof summary.extract === "string" ? summary.extract.trim() || null : null;
}

export async function fetchTheAudioDbArtist(name: string): Promise<{ bio: string | null; thumbUrl: string | null }> {
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
    const res = await boundedNativeFetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
      {
        method: "GET",
        headers: { "User-Agent": "Canon Music Player" },
      },
    );
    if (!res.ok) return null;
    return biographyFrom((await res.json()) as WikipediaSummary);
  } catch {
    return null;
  }
}

// More reliable than name lookup for artists with common/ambiguous names (e.g. "Ye").
export async function fetchWikipediaBioByMbid(mbid: string): Promise<string | null> {
  // The id is written into the SPARQL text, so only a real MusicBrainz id gets there.
  if (!isMbid(mbid)) return null;
  try {
    const sparql = `SELECT ?article WHERE { ?item wdt:P434 "${mbid}" . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`;
    const body = new URLSearchParams({ query: sparql, format: "json" }).toString();
    const res = await boundedNativeFetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "User-Agent": "Canon Music Player",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/sparql-results+json",
      },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { bindings?: Array<{ article?: { value: string } }> } };
    const articleUrl = data.results?.bindings?.[0]?.article?.value;
    if (!articleUrl) return null;
    const wikiTitle = decodeURIComponent(articleUrl.split("/wiki/")[1] ?? "")
      .replace(/#.*$/, "")
      .replace(/\?.*$/, "");
    if (!wikiTitle) return null;
    const summaryRes = await boundedNativeFetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`,
      { method: "GET", headers: { "User-Agent": "Canon Music Player" } },
    );
    if (!summaryRes.ok) return null;
    return biographyFrom((await summaryRes.json()) as WikipediaSummary);
  } catch {
    return null;
  }
}
