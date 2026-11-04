import type { DeezerAlbumHit, DiscographyEntry, Edition } from "../features/releaseDates/lib/releaseMatch";
import { awaitHostBudget, makeHostBudget } from "../lib/hostBudget";
import { boundedNativeFetch } from "./boundedFetch";

const DEEZER_API = "https://api.deezer.com";
// Deezer allows about 50 requests per 5s; this stays well under it.
const REQUEST_INTERVAL_MS = 200;
export const DEEZER_QUOTA_COOLDOWN_MS = 10_000;
const SEARCH_LIMIT = 10;
const DISCOGRAPHY_PAGE_SIZE = 100;
const DISCOGRAPHY_MAX_PAGES = 10;
const RELATED_LIMIT = 50;
const TOP_TRACKS_LIMIT = 50;
// Deezer reports errors in a 200 body: 4 is its quota, 800 "no data".
const QUOTA_EXCEEDED = 4;
const NO_DATA = 800;

// The API sends no CORS headers, so requests go through the native client.
const budget = makeHostBudget(REQUEST_INTERVAL_MS);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function holdOff(): void {
  budget.cooldownUntil = Date.now() + DEEZER_QUOTA_COOLDOWN_MS;
}

/** The answer's body, null for Deezer's "no data"; rejects on anything else that isn't an answer. */
async function getJson(url: string): Promise<JsonObject | null> {
  await awaitHostBudget(budget);
  const res = await boundedNativeFetch(url);
  if (res.status === 403 || res.status === 429) holdOff();
  if (!res.ok) throw new Error(`Deezer returned ${res.status}`);
  const body: unknown = await res.json();
  if (!isObject(body)) throw new Error("Deezer sent an unreadable answer");
  if (isObject(body.error)) {
    const { code, message } = body.error;
    if (code === NO_DATA) return null;
    if (code === QUOTA_EXCEEDED) holdOff();
    throw new Error(`Deezer error ${String(code)}: ${String(message)}`);
  }
  return body;
}

function dataOf(body: JsonObject | null): JsonObject[] {
  return body !== null && Array.isArray(body.data) ? body.data.filter(isObject) : [];
}

// A quote would end the field early.
function searchField(value: string): string {
  return value.replace(/"/g, " ").replace(/\s+/g, " ").trim();
}

export interface DeezerAlbumSearchHit extends DeezerAlbumHit {
  /** Deezer's 1000px cover, https only; shown, never stored (Deezer's terms). */
  coverUrl: string | null;
}

export async function searchDeezerAlbums(artist: string, title: string): Promise<DeezerAlbumSearchHit[]> {
  const url = new URL(`${DEEZER_API}/search/album`);
  url.searchParams.set("q", `artist:"${searchField(artist)}" album:"${searchField(title)}"`);
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  return dataOf(await getJson(url.toString())).flatMap((hit) => {
    const {
      id,
      title: hitTitle,
      record_type: recordType,
      nb_tracks: trackCount,
      artist: hitArtist,
      cover_xl: cover,
    } = hit;
    if (typeof id !== "number" || typeof hitTitle !== "string" || typeof recordType !== "string") return [];
    if (typeof trackCount !== "number" || !isObject(hitArtist)) return [];
    if (typeof hitArtist.id !== "number" || typeof hitArtist.name !== "string") return [];
    const coverUrl = typeof cover === "string" && cover.startsWith("https://") ? cover : null;
    return [
      { id, title: hitTitle, recordType, trackCount, artistId: hitArtist.id, artistName: hitArtist.name, coverUrl },
    ];
  });
}

/** One edition's date, label and type; null when Deezer no longer has it. */
export async function fetchDeezerAlbum(id: number): Promise<Edition | null> {
  const body = await getJson(`${DEEZER_API}/album/${id}`);
  if (body === null) return null;
  const { release_date: releaseDate, label, record_type: recordType } = body;
  if (typeof releaseDate !== "string" || typeof recordType !== "string") return null;
  return { releaseDate, label: typeof label === "string" && label !== "" ? label : null, recordType };
}

/** Every release Deezer lists for the artist, up to a page cap. */
export async function fetchDeezerDiscography(artistId: number): Promise<DiscographyEntry[]> {
  const entries: DiscographyEntry[] = [];
  let url: string | null = `${DEEZER_API}/artist/${artistId}/albums?limit=${DISCOGRAPHY_PAGE_SIZE}`;
  for (let page = 0; url !== null && page < DISCOGRAPHY_MAX_PAGES; page++) {
    const body = await getJson(url);
    for (const { title, record_type: recordType, release_date: releaseDate } of dataOf(body)) {
      if (typeof title === "string" && typeof recordType === "string" && typeof releaseDate === "string") {
        entries.push({ title, recordType, releaseDate });
      }
    }
    const next = body?.next;
    url = typeof next === "string" && next.startsWith(`${DEEZER_API}/`) ? next : null;
  }
  return entries;
}

export interface DeezerArtist {
  id: number;
  name: string;
}

export interface DeezerTopTrack {
  title: string;
  albumTitle: string | null;
}

function artistsOf(body: JsonObject | null): DeezerArtist[] {
  return dataOf(body).flatMap(({ id, name }) =>
    typeof id === "number" && typeof name === "string" ? [{ id, name }] : [],
  );
}

/** Every artist Deezer lists for the name, same-named strangers included. */
export async function searchDeezerArtists(name: string): Promise<DeezerArtist[]> {
  const url = new URL(`${DEEZER_API}/search/artist`);
  url.searchParams.set("q", name);
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  return artistsOf(await getJson(url.toString()));
}

/** Deezer's related artists, in its own order; it gives no score. */
export async function fetchDeezerRelatedArtists(artistId: number): Promise<DeezerArtist[]> {
  return artistsOf(await getJson(`${DEEZER_API}/artist/${artistId}/related?limit=${RELATED_LIMIT}`));
}

/** The artist's tracks most popular first; Deezer's rank is a global score, not a play count. */
export async function fetchDeezerArtistTopTracks(artistId: number): Promise<DeezerTopTrack[]> {
  return dataOf(await getJson(`${DEEZER_API}/artist/${artistId}/top?limit=${TOP_TRACKS_LIMIT}`)).flatMap(
    ({ title, album }) => {
      if (typeof title !== "string") return [];
      const albumTitle = isObject(album) && typeof album.title === "string" ? album.title : null;
      return [{ title, albumTitle }];
    },
  );
}
