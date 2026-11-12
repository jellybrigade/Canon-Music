import { boundedNativeFetch } from "./boundedFetch";

const USER_AGENT = "Canon Music Player";
const WIKIDATA_ITEM_ID = /^Q\d+$/;

export interface WikidataStatement {
  rank?: string;
  mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } };
}

/** Statements by property id ("P571"). */
export type WikidataClaims = Record<string, WikidataStatement[] | undefined>;

interface WikidataEntitiesResponse {
  entities?: Record<string, { claims?: WikidataClaims }>;
  error?: { code?: string; info?: string };
}

/** Every statement on a Wikidata item, or null for an item Wikidata doesn't have. Rejects when Wikidata didn't answer. */
export async function fetchWikidataClaims(itemId: string): Promise<WikidataClaims | null> {
  if (!WIKIDATA_ITEM_ID.test(itemId)) return null;
  const res = await boundedNativeFetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${itemId}&props=claims&format=json`,
    { method: "GET", headers: { "User-Agent": USER_AGENT } },
  );
  if (!res.ok) throw new Error(`Wikidata returned ${res.status}`);
  const data = (await res.json()) as WikidataEntitiesResponse;
  // Errors ride a 200; only "no such item" says there is none.
  if (data.error) {
    if (data.error.code === "no-such-entity") return null;
    throw new Error(`Wikidata error ${data.error.code ?? "unknown"}: ${data.error.info ?? ""}`);
  }
  return data.entities?.[itemId]?.claims ?? null;
}
