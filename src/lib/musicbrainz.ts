/**
 * MusicBrainz metadata client.
 *
 * Uses @tauri-apps/plugin-http (not browser fetch) so that a proper
 * User-Agent header can be set — required by MB's usage policy.
 *
 * Rate limit: ≥ 1 req/sec (MB enforces this server-side; we use 1100 ms).
 *
 * Genre note: MB stores community-voted genres at both Release Group and
 * Release level. Combined genres = union(RG genres, matched-release genres).
 * We do NOT fetch every pressing's genres — MB's 1 req/sec makes a
 * full-catalog union prohibitively slow.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { makeRateLimiter } from "./rate-limiter";

const MB_BASE = "https://musicbrainz.org/ws/2/";
// Kept in sync with tauri.conf.json / package.json version
const APP_VERSION = "0.1.0";
const USER_AGENT = `Canon/${APP_VERSION} ( https://github.com/jellybrigade/canon )`;

// MB enforces ≤ 1 req/sec; use 1100 ms for safe margin
const rateLimit = makeRateLimiter(1100);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MbGenre {
  name: string;
  count: number;
}

export interface MbReleaseGroupCandidate {
  id: string;
  title: string;
  firstReleaseDate: string | null;
  primaryType: string | null;
  artistName: string;
  artistMbid: string | null;
  /** MB's own Lucene relevance score (0–100). Tiebreaker only — use our fuzzy score as primary. */
  score: number | null;
}

export interface MbReleaseGroupDetail {
  id: string;
  title: string;
  firstReleaseDate: string | null;
  primaryType: string | null;
  artistName: string;
  artistMbid: string | null;
  genres: MbGenre[];
  tags: MbGenre[];
  releases: MbReleaseSummary[];
}

export interface MbReleaseSummary {
  id: string;
  title: string;
  date: string | null;
  country: string | null;
}

export interface MbReleaseDetail {
  id: string;
  title: string;
  date: string | null;
  country: string | null;
  label: string | null;
  catalogNumber: string | null;
  barcode: string | null;
  genres: MbGenre[];
  tags: MbGenre[];
}

export interface MbArtistCandidate {
  id: string;
  name: string;
  disambiguation: string | null;
  country: string | null;
}

export interface MbArtistDetail {
  id: string;
  name: string;
  disambiguation: string | null;
  country: string | null;
  genres: MbGenre[];
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function mbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  await rateLimit();
  const url = new URL(path, MB_BASE);
  url.searchParams.set("fmt", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await tauriFetch(url.toString(), {
    method: "GET",
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`MusicBrainz ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Release Group search ───────────────────────────────────────────────────────

interface MbSearchRGResponse {
  "release-groups"?: Array<{
    id: string;
    title: string;
    score?: number;
    "first-release-date"?: string;
    "primary-type"?: string;
    "artist-credit"?: Array<{
      artist?: { id: string; name: string };
    }>;
  }>;
}

export async function searchReleaseGroups(
  artist: string,
  album: string
): Promise<MbReleaseGroupCandidate[]> {
  type RgHit = NonNullable<MbSearchRGResponse["release-groups"]>[number];
  const toCandidate = (rg: RgHit) => {
    const credit = rg["artist-credit"]?.[0]?.artist;
    return {
      id: rg.id,
      title: rg.title,
      firstReleaseDate: rg["first-release-date"] ?? null,
      primaryType: rg["primary-type"] ?? null,
      artistName: credit?.name ?? artist,
      artistMbid: credit?.id ?? null,
      score: rg.score ?? null,
    };
  };

  const fullQuery = `releasegroup:${JSON.stringify(album)} AND artist:${JSON.stringify(artist)}`;
  const data = await mbGet<MbSearchRGResponse>("release-group", {
    query: fullQuery,
    limit: "25",
  });

  const results = data["release-groups"] ?? [];
  const bestScore = results.length > 0 ? Math.max(...results.map(r => r.score ?? 0)) : 0;
  if (bestScore >= 50) return results.map(toCandidate);

  // Fallback: artist-name exact match can fail for aliases/credits (e.g. "Brian Eno" vs "Eno"),
  // or when MB returns hits with score < 50 that don't actually match.
  // Retry with album title only; caller's rankCandidates will filter by artist similarity.
  const albumOnlyData = await mbGet<MbSearchRGResponse>("release-group", {
    query: `releasegroup:${JSON.stringify(album)}`,
    limit: "25",
  });
  return (albumOnlyData["release-groups"] ?? []).map(toCandidate);
}

// ── Release Group lookup ───────────────────────────────────────────────────────

interface MbLookupRGResponse {
  id: string;
  title: string;
  "first-release-date"?: string;
  "primary-type"?: string;
  "artist-credit"?: Array<{ artist?: { id: string; name: string } }>;
  genres?: Array<{ name: string; count: number }>;
  tags?: Array<{ name: string; count: number }>;
  releases?: Array<{
    id: string;
    title: string;
    date?: string;
    country?: string;
  }>;
}

export async function lookupReleaseGroup(rgMbid: string): Promise<MbReleaseGroupDetail> {
  const data = await mbGet<MbLookupRGResponse>(`release-group/${rgMbid}`, {
    inc: "genres+tags+releases+artist-credits",
  });

  const credit = data["artist-credit"]?.[0]?.artist;
  return {
    id: data.id,
    title: data.title,
    firstReleaseDate: data["first-release-date"] ?? null,
    primaryType: data["primary-type"] ?? null,
    artistName: credit?.name ?? "",
    artistMbid: credit?.id ?? null,
    genres: (data.genres ?? []).map((g) => ({ name: g.name, count: g.count })),
    tags: (data.tags ?? []).map((t) => ({ name: t.name, count: t.count })),
    releases: (data.releases ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date ?? null,
      country: r.country ?? null,
    })),
  };
}

// ── Release lookup ─────────────────────────────────────────────────────────────

interface MbLookupReleaseResponse {
  id: string;
  title: string;
  date?: string;
  country?: string;
  barcode?: string;
  genres?: Array<{ name: string; count: number }>;
  tags?: Array<{ name: string; count: number }>;
  "label-info"?: Array<{
    label?: { name: string };
    "catalog-number"?: string;
  }>;
}

export async function lookupRelease(releaseMbid: string): Promise<MbReleaseDetail> {
  const data = await mbGet<MbLookupReleaseResponse>(`release/${releaseMbid}`, {
    inc: "genres+tags+labels",
  });

  const labelInfo = data["label-info"]?.[0];
  return {
    id: data.id,
    title: data.title,
    date: data.date ?? null,
    country: data.country ?? null,
    label: labelInfo?.label?.name ?? null,
    catalogNumber: labelInfo?.["catalog-number"] ?? null,
    barcode: data.barcode ?? null,
    genres: (data.genres ?? []).map((g) => ({ name: g.name, count: g.count })),
    tags: (data.tags ?? []).map((t) => ({ name: t.name, count: t.count })),
  };
}

// ── Artist search ──────────────────────────────────────────────────────────────

interface MbSearchArtistResponse {
  artists?: Array<{
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
  }>;
}

export async function searchArtists(name: string): Promise<MbArtistCandidate[]> {
  const data = await mbGet<MbSearchArtistResponse>("artist", {
    query: `artist:${JSON.stringify(name)}`,
    limit: "10",
  });

  return (data.artists ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    disambiguation: a.disambiguation ?? null,
    country: a.country ?? null,
  }));
}

// ── Artist release groups browse ───────────────────────────────────────────────

interface MbBrowseRGResponse {
  "release-groups"?: Array<{ id: string; title: string }>;
  "release-group-count"?: number;
}

/** Fetch all release group titles for an artist MBID (for disambiguation scoring). */
export async function fetchArtistReleaseGroupTitles(artistMbid: string): Promise<string[]> {
  const titles: string[] = [];
  let offset = 0;
  const limit = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await mbGet<MbBrowseRGResponse>("release-group", {
      artist: artistMbid,
      limit: String(limit),
      offset: String(offset),
    });
    const page = data["release-groups"] ?? [];
    titles.push(...page.map((rg) => rg.title));
    const total = data["release-group-count"] ?? 0;
    offset += page.length;
    if (offset >= total || page.length === 0) break;
    // Limit total pages to avoid excessive requests for artists with huge catalogs
    if (offset >= 300) break;
  }
  return titles;
}

// ── Artist lookup ──────────────────────────────────────────────────────────────

interface MbLookupArtistResponse {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
  genres?: Array<{ name: string; count: number }>;
}

export async function lookupArtist(artistMbid: string): Promise<MbArtistDetail> {
  const data = await mbGet<MbLookupArtistResponse>(`artist/${artistMbid}`, {
    inc: "genres",
  });

  return {
    id: data.id,
    name: data.name,
    disambiguation: data.disambiguation ?? null,
    country: data.country ?? null,
    genres: (data.genres ?? []).map((g) => ({ name: g.name, count: g.count })),
  };
}

// ── Wikidata image lookup ──────────────────────────────────────────────────────

interface WikidataSparqlResponse {
  results?: {
    bindings?: Array<{
      image?: { value: string };
    }>;
  };
}

export async function fetchWikidataImageByMbid(mbid: string): Promise<string | null> {
  try {
    const sparql = `SELECT ?image WHERE { ?item wdt:P434 "${mbid}" . ?item wdt:P18 ?image . } LIMIT 1`;
    const body = new URLSearchParams({ query: sparql, format: "json" }).toString();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const fetchResult = tauriFetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/sparql-results+json",
      },
      body,
    }).then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as WikidataSparqlResponse;
      return data.results?.bindings?.[0]?.image?.value ?? null;
    }).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch {
    return null;
  }
}

// ── Folksonomy threshold ───────────────────────────────────────────────────────

const MIN_FOLKSONOMY_COUNT_DEFAULT = 2;

export async function getMinFolksonomyCount(): Promise<number> {
  const { getDb } = await import("../db");
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'musicbrainz.min_folksonomy_count'"
  );
  const val = parseInt(rows[0]?.value ?? "", 10);
  return isNaN(val) ? MIN_FOLKSONOMY_COUNT_DEFAULT : val;
}

export async function setMinFolksonomyCount(count: number): Promise<void> {
  const { getDb } = await import("../db");
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('musicbrainz.min_folksonomy_count', ?)",
    [String(count)]
  );
}

// ── Genre utilities ────────────────────────────────────────────────────────────

/**
 * Combine genres from Release Group and a specific Release.
 * Deduped (case-insensitive name), sorted descending by combined vote count.
 * RG genres = aggregate community view; release genres = pressing-specific.
 */
export function combineGenres(rgGenres: MbGenre[], releaseGenres: MbGenre[]): MbGenre[] {
  const byName = new Map<string, MbGenre>();
  for (const g of [...rgGenres, ...releaseGenres]) {
    const key = g.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      byName.set(key, { name: existing.name, count: existing.count + g.count });
    } else {
      byName.set(key, { ...g });
    }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count);
}
