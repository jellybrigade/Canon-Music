import { type ItunesAlbum, parseItunesCollection } from "../features/releaseDates/lib/itunesAlbums";
import { awaitHostBudget, makeHostBudget } from "../lib/hostBudget";
import { boundedFetch } from "./boundedFetch";

const ITUNES_API = "https://itunes.apple.com";
// iTunes allows about 20 requests a minute per address and answers 403, not 429, past it.
const REQUEST_INTERVAL_MS = 3000;
export const ITUNES_LIMIT_COOLDOWN_MS = 60_000;
const ARTIST_SEARCH_LIMIT = 25;
const ARTIST_ALBUMS_LIMIT = 200;

const budget = makeHostBudget(REQUEST_INTERVAL_MS);

export interface ItunesArtist {
  id: number;
  name: string;
}

async function getResults(url: URL): Promise<unknown[]> {
  await awaitHostBudget(budget);
  const res = await boundedFetch(url.toString());
  if (res.status === 403 || res.status === 429) budget.cooldownUntil = Date.now() + ITUNES_LIMIT_COOLDOWN_MS;
  if (!res.ok) throw new Error(`iTunes returned ${res.status}`);
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("results" in body) || !Array.isArray(body.results)) {
    throw new Error("iTunes sent an unreadable answer");
  }
  return body.results;
}

/** Every artist iTunes lists for the name, same-named strangers included. */
export async function searchItunesArtists(name: string): Promise<ItunesArtist[]> {
  const url = new URL(`${ITUNES_API}/search`);
  url.searchParams.set("term", name);
  url.searchParams.set("entity", "musicArtist");
  url.searchParams.set("media", "music");
  url.searchParams.set("limit", String(ARTIST_SEARCH_LIMIT));
  return (await getResults(url)).flatMap((result) => {
    if (typeof result !== "object" || result === null) return [];
    if (!("artistId" in result) || !("artistName" in result)) return [];
    const { artistId, artistName } = result;
    return typeof artistId === "number" && typeof artistName === "string" ? [{ id: artistId, name: artistName }] : [];
  });
}

/** Every release iTunes lists for the artist. */
export async function fetchItunesArtistAlbums(artistId: number): Promise<ItunesAlbum[]> {
  const url = new URL(`${ITUNES_API}/lookup`);
  url.searchParams.set("id", String(artistId));
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", String(ARTIST_ALBUMS_LIMIT));
  return (await getResults(url)).flatMap((result) => {
    const album = parseItunesCollection(result);
    return album === null ? [] : [album];
  });
}
