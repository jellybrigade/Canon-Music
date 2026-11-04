import { awaitHostBudget, type HostBudget, makeHostBudget } from "../lib/hostBudget";
import { boundedNativeFetch } from "./boundedFetch";

const LISTENBRAINZ_API = "https://api.listenbrainz.org/1";
const LISTENBRAINZ_LABS = "https://labs.api.listenbrainz.org";
// ListenBrainz's own artist pages use this; a retired one answers 400, never an empty list.
const SIMILAR_ARTISTS_ALGORITHM =
  "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";
// ListenBrainz allows about 30 requests per 10s per address.
const REQUEST_INTERVAL_MS = 1000;
const DEFAULT_COOLDOWN_MS = 10_000;
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The popularity endpoints allow only GET in CORS, so requests go through the native client.
const apiBudget = makeHostBudget(REQUEST_INTERVAL_MS);
const labsBudget = makeHostBudget(REQUEST_INTERVAL_MS);

export interface ListenBrainzSimilarArtist {
  mbid: string;
  name: string;
  score: number;
}

export interface ListenBrainzArtistPopularity {
  mbid: string;
  /** All-time listens, MLHD+ history included: a smaller, older-leaning scale than Last.fm's. */
  listenCount: number | null;
  userCount: number | null;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cooldownMs(res: Response): number {
  const seconds = Number.parseFloat(res.headers.get("X-RateLimit-Reset-In") ?? "");
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_COOLDOWN_MS;
}

async function getList(budget: HostBudget, url: string, init: RequestInit = {}): Promise<JsonObject[]> {
  await awaitHostBudget(budget);
  const res = await boundedNativeFetch(url, init);
  if (res.status === 429) budget.cooldownUntil = Date.now() + cooldownMs(res);
  if (!res.ok) throw new Error(`ListenBrainz returned ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error("ListenBrainz sent an unreadable answer");
  return body.filter(isObject);
}

/** Artists ListenBrainz listeners play in the same sessions, best first; empty when it knows none. */
export async function fetchListenBrainzSimilarArtists(artistMbid: string): Promise<ListenBrainzSimilarArtist[]> {
  if (!MBID_PATTERN.test(artistMbid)) return [];
  const url = new URL(`${LISTENBRAINZ_LABS}/similar-artists/json`);
  url.searchParams.set("artist_mbids", artistMbid);
  url.searchParams.set("algorithm", SIMILAR_ARTISTS_ALGORITHM);
  return (await getList(labsBudget, url.toString()))
    .flatMap(({ artist_mbid: mbid, name, score }) =>
      typeof mbid === "string" && typeof name === "string" && typeof score === "number" ? [{ mbid, name, score }] : [],
    )
    .sort((a, b) => b.score - a.score);
}

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Listen and user counts per artist, in the order asked; null counts for an artist it has none for. */
export async function fetchListenBrainzArtistPopularity(
  artistMbids: string[],
): Promise<ListenBrainzArtistPopularity[]> {
  const ids = artistMbids.filter((id) => MBID_PATTERN.test(id));
  if (ids.length === 0) return [];
  const rows = await getList(apiBudget, `${LISTENBRAINZ_API}/popularity/artist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist_mbids: ids }),
  });
  return rows.flatMap(({ artist_mbid: mbid, total_listen_count: listens, total_user_count: users }) =>
    typeof mbid === "string" ? [{ mbid, listenCount: countOrNull(listens), userCount: countOrNull(users) }] : [],
  );
}
