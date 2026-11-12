import type { DiscogsRelease, DiscogsSearchHit } from "../features/albumFacts/lib/discogsMatch";
import { awaitHostBudget, makeHostBudget } from "../lib/hostBudget";
import { boundedNativeFetch } from "./boundedFetch";

const DISCOGS_API = "https://api.discogs.com";
// Discogs requires a User-Agent naming the app, which the webview won't send.
const USER_AGENT = "Canon ( https://github.com/jellybrigade/canon )";
// Discogs allows 25 requests a minute without a token.
export const DISCOGS_REQUEST_INTERVAL_MS = 2_500;
export const DISCOGS_QUOTA_COOLDOWN_MS = 60_000;
const SEARCH_PAGE_SIZE = 50;

const budget = makeHostBudget(DISCOGS_REQUEST_INTERVAL_MS);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectsOf(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The answer's body, null for a 404; rejects on anything else that isn't an answer. */
async function getJson(path: string, params: Record<string, string> = {}): Promise<JsonObject | null> {
  const url = new URL(path, DISCOGS_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  await awaitHostBudget(budget);
  const res = await boundedNativeFetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (res.status === 429) budget.cooldownUntil = Date.now() + DISCOGS_QUOTA_COOLDOWN_MS;
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discogs ${path} returned ${res.status}`);
  const body: unknown = await res.json();
  if (!isObject(body)) throw new Error("Discogs sent an unreadable answer");
  return body;
}

const TITLE_SEPARATOR = " - ";

function parseSearchHit(result: JsonObject): DiscogsSearchHit | null {
  const { id, master_id: masterId, title, year } = result;
  if (typeof id !== "number" || typeof title !== "string") return null;
  const split = title.indexOf(TITLE_SEPARATOR);
  if (split < 0) return null;
  const parsedYear = typeof year === "string" ? Number.parseInt(year, 10) : Number.NaN;
  return {
    id,
    masterId: typeof masterId === "number" && masterId > 0 ? masterId : null,
    artistName: title.slice(0, split),
    title: title.slice(split + TITLE_SEPARATOR.length),
    year: Number.isFinite(parsedYear) ? parsedYear : null,
  };
}

/** Releases (pressings) Discogs lists under the artist and title. Rejects when the search didn't answer. */
export async function searchDiscogsReleases(artist: string, title: string): Promise<DiscogsSearchHit[]> {
  const body = await getJson("/database/search", {
    artist,
    release_title: title,
    type: "release",
    per_page: String(SEARCH_PAGE_SIZE),
  });
  if (body === null) throw new Error("Discogs search is not available");
  return objectsOf(body.results)
    .map(parseSearchHit)
    .filter((hit) => hit !== null);
}

/** The release Discogs picked as the master's original, or null when it has no such master. */
export async function fetchDiscogsMainReleaseId(masterId: number): Promise<number | null> {
  const body = await getJson(`/masters/${masterId}`);
  if (body === null) return null;
  if (typeof body.main_release !== "number") throw new Error("Discogs master has no main release");
  return body.main_release;
}

function countTracks(tracklist: JsonObject[]): number {
  let count = 0;
  for (const entry of tracklist) {
    if (entry.type_ === "track") count += 1;
    else if (entry.type_ === "index") count += Math.max(1, objectsOf(entry.sub_tracks).length);
  }
  return count;
}

export async function fetchDiscogsRelease(releaseId: number): Promise<DiscogsRelease | null> {
  const body = await getJson(`/releases/${releaseId}`);
  if (body === null) return null;
  if (typeof body.id !== "number" || typeof body.title !== "string") {
    throw new Error("Discogs sent a release without a title");
  }
  return {
    id: body.id,
    title: body.title,
    artistNames: objectsOf(body.artists).flatMap(({ name }) => (typeof name === "string" ? [name] : [])),
    labels: objectsOf(body.labels).flatMap(({ name, catno }) =>
      typeof name === "string" ? [{ name, catalogNumber: typeof catno === "string" ? catno : "" }] : [],
    ),
    country: typeof body.country === "string" ? body.country : null,
    genres: stringsOf(body.genres),
    styles: stringsOf(body.styles),
    formatDescriptions: objectsOf(body.formats).flatMap(({ descriptions }) => stringsOf(descriptions)),
    trackCount: countTracks(objectsOf(body.tracklist)),
  };
}
