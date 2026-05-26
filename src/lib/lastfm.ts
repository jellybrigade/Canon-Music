import { getDb } from "../db";
import { canonicalKey } from "./canonicalize";
import type { TagKind } from "./canonicalize";

export interface LastfmTagResult {
  genres: string[];
  moods: string[];
}

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS = 10;
const REQUEST_INTERVAL_MS = 250; // ≤ 4 req/s to stay well within rate limit

let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = REQUEST_INTERVAL_MS - (now - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function getApiKey(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'lastfm.api_key'"
  );
  return rows[0]?.value ?? null;
}

async function fetchTags(method: string, params: Record<string, string>, apiKey: string): Promise<string[]> {
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
  return (data.toptags?.tag ?? []).map((t) => t.name).slice(0, MAX_TAGS);
}

export async function fetchAlbumTags(artist: string, album: string): Promise<LastfmTagResult> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Last.fm API key not configured");

  const [albumTags, artistTags] = await Promise.allSettled([
    fetchTags("album.getTopTags", { artist, album }, apiKey),
    fetchTags("artist.getTopTags", { artist }, apiKey),
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
