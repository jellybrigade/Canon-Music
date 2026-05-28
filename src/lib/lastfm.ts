import { getDb } from "../db";
import { canonicalKey } from "./canonicalize";
import type { TagKind } from "./canonicalize";

export interface LastfmTagResult {
  genres: string[];
  moods: string[];
}

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS = 10;
const MIN_TAG_COUNT_DEFAULT = 25;
const REQUEST_INTERVAL_MS = 250; // ≤ 4 req/s to stay well within rate limit

let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = REQUEST_INTERVAL_MS - (now - lastRequestAt);
  lastRequestAt = now + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getApiKey(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'lastfm.api_key'"
  );
  return rows[0]?.value ?? null;
}

export async function getMinTagCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'lastfm.min_tag_count'"
  );
  const val = parseInt(rows[0]?.value ?? "", 10);
  return isNaN(val) ? MIN_TAG_COUNT_DEFAULT : val;
}

export async function setMinTagCount(count: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm.min_tag_count', ?)",
    [String(count)]
  );
}

async function fetchTags(method: string, params: Record<string, string>, apiKey: string, minCount: number): Promise<string[]> {
  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Last.fm ${method} returned ${res.status}`);

  const data = (await res.json()) as {
    toptags?: { tag?: Array<{ name: string; count?: number }> };
    error?: number;
    message?: string;
  };

  if (data.error) throw new Error(data.message ?? `Last.fm error ${data.error}`);
  return (data.toptags?.tag ?? [])
    .filter((t) => (t.count ?? 0) >= minCount)
    .map((t) => t.name)
    .slice(0, MAX_TAGS);
}

export async function fetchAlbumTags(artist: string, album: string): Promise<LastfmTagResult> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Last.fm API key not configured");
  const minCount = await getMinTagCount();

  const [albumTags, artistTags] = await Promise.allSettled([
    fetchTags("album.getTopTags", { artist, album }, apiKey, minCount),
    fetchTags("artist.getTopTags", { artist }, apiKey, minCount),
  ]);

  const allTags = [
    ...(albumTags.status === "fulfilled" ? albumTags.value : []),
    ...(artistTags.status === "fulfilled" ? artistTags.value : []),
  ];

  // Separate genres and moods by checking against canon tree kind
  // Moods are determined dynamically using canonicalKey normalization
  // Simple heuristic: moods are a subset of known mood keywords
  // Actual split happens in useTagPull via findCanonical
  return { genres: allTags, moods: [] };
}

export async function fetchSimilarArtists(artist: string): Promise<string[]> {
  const apiKey = await getApiKey();
  if (!apiKey) return [];
  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "artist.getSimilar");
  url.searchParams.set("artist", artist);
  url.searchParams.set("limit", "20");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString());
  if (!res.ok) return [];

  const data = (await res.json()) as {
    similarartists?: { artist?: Array<{ name: string }> };
    error?: number;
  };
  if (data.error) return [];
  return (data.similarartists?.artist ?? []).map((a) => a.name);
}

export async function fetchArtistImage(artist: string): Promise<string | null> {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  try {
    await rateLimit();
    const url = new URL(LASTFM_BASE);
    url.searchParams.set("method", "artist.getInfo");
    url.searchParams.set("artist", artist);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as {
      artist?: { image?: Array<{ "#text": string; size: string }> };
      error?: number;
    };
    if (data.error || !data.artist?.image) return null;
    const images = data.artist.image.filter((img) => img["#text"]);
    const extralarge = images.find((img) => img.size === "extralarge");
    const large = images.find((img) => img.size === "large");
    const chosen = extralarge ?? large ?? images[images.length - 1];
    return chosen?.["#text"] ?? null;
  } catch {
    return null;
  }
}

// Classify a raw Last.fm tag as genre or mood based on canon tree lookup
export async function classifyTag(rawTag: string): Promise<TagKind> {
  const { getCanonTree } = await import("./canonicalize");
  const tree = await getCanonTree();
  const key = canonicalKey(rawTag);

  const genreNode = tree.nodes.find((n) => n.type === "genre" && n.canonical_key === key);
  if (genreNode) return "genre";

  const moodNode = tree.nodes.find((n) => n.type === "mood" && n.canonical_key === key);
  if (moodNode) return "mood";

  // Default: treat as genre if unrecognized (user can reclassify via Vocabulary)
  return "genre";
}
