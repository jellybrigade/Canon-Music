import { getDb } from "../db";
import { keychain } from "../keychain";
import { canonicalKey } from "./canonicalize";
import type { TagKind } from "./canonicalize";
import { makeRateLimiter } from "./rate-limiter";

const LASTFM_KEYCHAIN_SERVICE = "canon.lastfm";
const LASTFM_KEYCHAIN_ACCOUNT = "api_key";

export interface LastfmTagResult {
  genres: string[];
  moods: string[];
}

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS = 10;
const MIN_TAG_COUNT_DEFAULT = 5;
// ≤ 4 req/s to stay well within Last.fm rate limit
const rateLimit = makeRateLimiter(250);

async function getApiKey(): Promise<string | null> {
  try {
    const key = await keychain.get(LASTFM_KEYCHAIN_SERVICE, LASTFM_KEYCHAIN_ACCOUNT);
    if (key) return key;
  } catch { /* not in keychain yet */ }
  // Migration: move legacy SQLite key to keychain on first access
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = 'lastfm.api_key'"
    );
    const legacy = rows[0]?.value;
    if (legacy) {
      await keychain.set(LASTFM_KEYCHAIN_SERVICE, LASTFM_KEYCHAIN_ACCOUNT, legacy);
      await db.execute("DELETE FROM settings WHERE key = 'lastfm.api_key'");
      return legacy;
    }
  } catch { /* migration not critical */ }
  return null;
}

export async function setApiKey(key: string): Promise<void> {
  if (key) {
    await keychain.set(LASTFM_KEYCHAIN_SERVICE, LASTFM_KEYCHAIN_ACCOUNT, key);
  } else {
    try { await keychain.delete(LASTFM_KEYCHAIN_SERVICE, LASTFM_KEYCHAIN_ACCOUNT); } catch { /* ok */ }
  }
  // Remove any lingering SQLite copy
  try {
    const db = await getDb();
    await db.execute("DELETE FROM settings WHERE key = 'lastfm.api_key'");
  } catch { /* ok */ }
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
  const tags = await fetchTags("album.getTopTags", { artist, album }, apiKey, minCount);
  return { genres: tags, moods: [] };
}

export async function fetchTrackTags(artist: string, track: string): Promise<LastfmTagResult> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Last.fm API key not configured");
  const minCount = await getMinTagCount();
  const tags = await fetchTags("track.getTopTags", { artist, track }, apiKey, minCount);
  const genres: string[] = [];
  const moods: string[] = [];
  for (const t of tags) {
    const kind = await classifyTag(t);
    if (kind === "genre") genres.push(t);
    else if (kind === "mood") moods.push(t);
  }
  return { genres, moods };
}

export async function fetchArtistGenreTags(artist: string): Promise<string[]> {
  const apiKey = await getApiKey();
  if (!apiKey) return [];
  const minCount = await getMinTagCount();
  try {
    return await fetchTags("artist.getTopTags", { artist }, apiKey, minCount);
  } catch {
    return [];
  }
}

export interface LastfmArtistInfo {
  bio: string | null;
  listeners: number | null;
  playcount: number | null;
  similar: string[];
  topTags: string[];
  imageUrl: string | null;
}

// Hash of Last.fm's "missing artist" placeholder image — reject it everywhere
export const LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

function pickImage(images: Array<{ "#text": string; size: string }>): string | null {
  const filtered = images.filter(
    (img) => img["#text"] && !img["#text"].includes(LASTFM_PLACEHOLDER)
  );
  const extralarge = filtered.find((img) => img.size === "extralarge");
  const large = filtered.find((img) => img.size === "large");
  const chosen = extralarge ?? large ?? filtered[filtered.length - 1];
  return chosen?.["#text"] ?? null;
}

function stripBioBoilerplate(html: string): string {
  // Strip Last.fm "Read more on Last.fm" link and surrounding whitespace
  return html
    .replace(/<a[^>]*>Read more on Last\.fm<\/a>\.?/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export async function fetchArtistInfo(artist: string): Promise<LastfmArtistInfo> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { bio: null, listeners: null, playcount: null, similar: [], topTags: [], imageUrl: null };
  }
  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "artist.getInfo");
  url.searchParams.set("artist", artist);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Last.fm artist.getInfo returned ${res.status}`);
    const data = (await res.json()) as {
      artist?: {
        bio?: { content?: string };
        stats?: { listeners?: string; playcount?: string };
        similar?: { artist?: Array<{ name: string }> };
        tags?: { tag?: Array<{ name: string }> };
        image?: Array<{ "#text": string; size: string }>;
      };
      error?: number;
      message?: string;
    };
    if (data.error) throw new Error(data.message ?? `Last.fm error ${data.error}`);
    const a = data.artist;
    if (!a) throw new Error("No artist data");
    return {
      bio: a.bio?.content ? stripBioBoilerplate(a.bio.content) || null : null,
      listeners: a.stats?.listeners ? parseInt(a.stats.listeners, 10) || null : null,
      playcount: a.stats?.playcount ? parseInt(a.stats.playcount, 10) || null : null,
      similar: (a.similar?.artist ?? []).map((x) => x.name).slice(0, 10),
      topTags: (a.tags?.tag ?? []).map((t) => t.name).slice(0, 10),
      imageUrl: a.image ? pickImage(a.image) : null,
    };
  } catch {
    return { bio: null, listeners: null, playcount: null, similar: [], topTags: [], imageUrl: null };
  }
}

const SIGNAL_CACHE_TTL_S = 7 * 24 * 3600;

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const db = await getDb();
    const cutoff = Math.floor(Date.now() / 1000) - SIGNAL_CACHE_TTL_S;
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM radio_signal_cache WHERE cache_key = ? AND fetched_at > ?",
      [key, cutoff]
    );
    if (rows[0]) return JSON.parse(rows[0].value) as T;
  } catch { /* cache miss */ }
  return null;
}

async function setCached<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO radio_signal_cache (cache_key, value, fetched_at) VALUES (?, ?, ?)",
      [key, JSON.stringify(value), Math.floor(Date.now() / 1000)]
    );
  } catch { /* non-critical */ }
}

export interface SimilarArtistEntry {
  name: string;
  match: number;
}

export async function fetchSimilarArtistsFull(artist: string): Promise<SimilarArtistEntry[]> {
  const cacheKey = `artist.getSimilar:${artist.toLowerCase()}`;
  const cached = await getCached<SimilarArtistEntry[]>(cacheKey);
  if (cached) return cached;

  const apiKey = await getApiKey();
  if (!apiKey) return [];

  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "artist.getSimilar");
  url.searchParams.set("artist", artist);
  url.searchParams.set("limit", "50");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as {
      similarartists?: { artist?: Array<{ name: string; match: string }> };
      error?: number;
    };
    if (data.error) return [];
    const result = (data.similarartists?.artist ?? []).map((a) => ({
      name: a.name,
      match: parseFloat(a.match) || 0,
    }));
    await setCached(cacheKey, result);
    return result;
  } catch {
    return [];
  }
}

export async function fetchSimilarArtists(artist: string): Promise<string[]> {
  const full = await fetchSimilarArtistsFull(artist);
  return full.map((a) => a.name).slice(0, 10);
}

export interface SimilarTrackEntry {
  artist: string;
  title: string;
  match: number;
}

export async function fetchSimilarTracks(artist: string, title: string): Promise<SimilarTrackEntry[]> {
  const cacheKey = `track.getSimilar:${artist.toLowerCase()}:${title.toLowerCase()}`;
  const cached = await getCached<SimilarTrackEntry[]>(cacheKey);
  if (cached) return cached;

  const apiKey = await getApiKey();
  if (!apiKey) return [];

  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "track.getSimilar");
  url.searchParams.set("artist", artist);
  url.searchParams.set("track", title);
  url.searchParams.set("limit", "100");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as {
      similartracks?: { track?: Array<{ name: string; artist: { name: string }; match: number }> };
      error?: number;
    };
    if (data.error) return [];
    const result = (data.similartracks?.track ?? []).map((t) => ({
      artist: t.artist.name,
      title: t.name,
      match: t.match || 0,
    }));
    await setCached(cacheKey, result);
    return result;
  } catch {
    return [];
  }
}

export interface LastfmAlbumInfo {
  bio: string | null;
  url: string | null;
}

export async function fetchAlbumInfo(artist: string, album: string): Promise<LastfmAlbumInfo> {
  const apiKey = await getApiKey();
  if (!apiKey) return { bio: null, url: null };
  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "album.getInfo");
  url.searchParams.set("artist", artist);
  url.searchParams.set("album", album);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return { bio: null, url: null };
    const data = (await res.json()) as {
      album?: {
        wiki?: { summary?: string };
        url?: string;
      };
      error?: number;
    };
    if (data.error || !data.album) return { bio: null, url: null };
    const raw = data.album.wiki?.summary ?? null;
    return {
      bio: raw ? stripBioBoilerplate(raw) || null : null,
      url: data.album.url ?? null,
    };
  } catch {
    return { bio: null, url: null };
  }
}

export async function fetchArtistImage(artist: string): Promise<string | null> {
  const info = await fetchArtistInfo(artist);
  return info.imageUrl;
}

export interface LastfmTopTrack {
  name: string;
  playcount: number;
}

export interface LastfmTopAlbum {
  name: string;
  playcount: number;
  listeners: number;
}

export async function fetchArtistTopAlbums(artist: string): Promise<LastfmTopAlbum[]> {
  const apiKey = await getApiKey();
  if (!apiKey) return [];
  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "artist.getTopAlbums");
  url.searchParams.set("artist", artist);
  url.searchParams.set("limit", "20");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as {
      topalbums?: { album?: Array<{ name: string; playcount?: string; listeners?: string }> };
      error?: number;
    };
    if (data.error) return [];
    return (data.topalbums?.album ?? []).map((a) => ({
      name: a.name,
      playcount: parseInt(a.playcount ?? "0", 10) || 0,
      listeners: parseInt(a.listeners ?? "0", 10) || 0,
    }));
  } catch {
    return [];
  }
}

export async function fetchArtistTopTracks(artist: string): Promise<LastfmTopTrack[]> {
  const apiKey = await getApiKey();
  if (!apiKey) return [];
  await rateLimit();
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", "artist.getTopTracks");
  url.searchParams.set("artist", artist);
  url.searchParams.set("limit", "50");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as {
      toptracks?: { track?: Array<{ name: string; playcount?: string }> };
      error?: number;
    };
    if (data.error) return [];
    return (data.toptracks?.track ?? []).map((t) => ({
      name: t.name,
      playcount: parseInt(t.playcount ?? "0", 10) || 0,
    }));
  } catch {
    return [];
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
