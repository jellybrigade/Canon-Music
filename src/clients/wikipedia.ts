import { isMbid } from "../lib/mbid";
import { boundedNativeFetch } from "./boundedFetch";

const USER_AGENT = "Canon Music Player";
const WIKIDATA_ITEM_ID = /^Q\d+$/;
const HTTP_NOT_FOUND = 404;

export interface WikipediaSummary {
  type?: string;
  extract?: string;
}

interface SparqlArticleResponse {
  results?: { bindings?: Array<{ article?: { value: string } }> };
}

interface WikidataEntitiesResponse {
  entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }>;
  error?: { code?: string; info?: string };
}

/** The lead of an article, or null for a disambiguation page or an empty one. */
export function summaryText(summary: WikipediaSummary): string | null {
  if (summary.type === "disambiguation") return null;
  return typeof summary.extract === "string" ? summary.extract.trim() || null : null;
}

export function titleFromArticleUrl(articleUrl: string): string | null {
  const path = articleUrl.split("/wiki/")[1];
  if (!path) return null;
  return decodeURIComponent(path).replace(/#.*$/, "").replace(/\?.*$/, "") || null;
}

/** The English article of the Wikidata item carrying this MusicBrainz release group id (P436).
 *  Rejects when Wikidata didn't answer. */
export async function fetchWikipediaTitleByReleaseGroup(releaseGroupMbid: string): Promise<string | null> {
  // The id is written into the SPARQL text, so only a real MusicBrainz id gets there.
  if (!isMbid(releaseGroupMbid)) return null;
  const sparql = `SELECT ?article WHERE { ?item wdt:P436 "${releaseGroupMbid}" . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`;
  const res = await boundedNativeFetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
    },
    body: new URLSearchParams({ query: sparql, format: "json" }).toString(),
  });
  if (!res.ok) throw new Error(`Wikidata returned ${res.status}`);
  const data = (await res.json()) as SparqlArticleResponse;
  const articleUrl = data.results?.bindings?.[0]?.article?.value;
  return articleUrl ? titleFromArticleUrl(articleUrl) : null;
}

/** The English article linked from a Wikidata item. Rejects when Wikidata didn't answer. */
export async function fetchWikipediaTitleByWikidataId(itemId: string): Promise<string | null> {
  if (!WIKIDATA_ITEM_ID.test(itemId)) return null;
  const res = await boundedNativeFetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${itemId}&props=sitelinks&sitefilter=enwiki&format=json`,
    { method: "GET", headers: { "User-Agent": USER_AGENT } },
  );
  if (!res.ok) throw new Error(`Wikidata returned ${res.status}`);
  const data = (await res.json()) as WikidataEntitiesResponse;
  // Errors ride a 200; only "no such item" says there is none.
  if (data.error) {
    if (data.error.code === "no-such-entity") return null;
    throw new Error(`Wikidata error ${data.error.code ?? "unknown"}: ${data.error.info ?? ""}`);
  }
  return data.entities?.[itemId]?.sitelinks?.enwiki?.title?.trim() || null;
}

/** An English article's lead. Null for a missing or disambiguation page; rejects when Wikipedia didn't answer. */
export async function fetchWikipediaSummaryText(title: string): Promise<string | null> {
  const res = await boundedNativeFetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { method: "GET", headers: { "User-Agent": USER_AGENT } },
  );
  if (res.status === HTTP_NOT_FOUND) return null;
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  return summaryText((await res.json()) as WikipediaSummary);
}
