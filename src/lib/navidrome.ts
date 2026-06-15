import { md5 } from "js-md5";

let _streamMaxBitrate = 0;
export function setStreamMaxBitrate(kbps: number): void {
  _streamMaxBitrate = kbps;
}

export type NavidromeCredential =
  | { type: "md5"; token: string; salt: string }
  | { type: "apikey"; apiKey: string };

export interface NavidromeAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  year?: number;
  starred?: string;
  created?: string;
  songCount?: number;
  playCount?: number;
  releaseTypes?: string[];
  releaseType?: string;
}

function generateSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUrl(url: string): string {
  // Strip trailing slashes and accidental /rest suffix
  return url.replace(/\/+$/, "").replace(/\/rest$/, "");
}

function buildAuthParams(
  username: string,
  credential: NavidromeCredential
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("u", username);
  if (credential.type === "apikey") {
    p.set("apiKey", credential.apiKey);
  } else {
    p.set("t", credential.token);
    p.set("s", credential.salt);
  }
  p.set("v", "1.16.1");
  p.set("c", "canon");
  p.set("f", "json");
  return p;
}

async function apiPost(
  baseUrl: string,
  endpoint: string,
  params: URLSearchParams
): Promise<Response> {
  const url = `${normalizeUrl(baseUrl)}/rest/${endpoint}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

export function getCoverArtUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  coverArtId: string,
  size = 300
): string {
  const params = buildAuthParams(username, credential);
  params.set("id", coverArtId);
  params.set("size", String(size));
  return `${normalizeUrl(baseUrl)}/rest/getCoverArt?${params.toString()}`;
}

export async function fetchAllAlbums(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<NavidromeAlbum[]> {
  const PAGE_SIZE = 500;
  const albums: NavidromeAlbum[] = [];
  let offset = 0;

  while (true) {
    const params = buildAuthParams(username, credential);
    params.set("type", "alphabeticalByName");
    params.set("size", String(PAGE_SIZE));
    params.set("offset", String(offset));

    const res = await apiPost(baseUrl, "getAlbumList2", params);
    if (!res.ok) throw new Error(`getAlbumList2 returned ${res.status}`);

    const data = (await res.json()) as {
      "subsonic-response": {
        status: string;
        error?: { code: number; message: string };
        albumList2?: { album?: NavidromeAlbum[] };
      };
    };

    const response = data["subsonic-response"];
    if (response.status !== "ok") {
      throw new Error(response.error?.message ?? "Failed to fetch albums");
    }

    const page = response.albumList2?.album ?? [];
    albums.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return albums;
}

export async function fetchAlbumListByType(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  type: "recent" | "frequent" | "newest",
  size = 20
): Promise<NavidromeAlbum[]> {
  const params = buildAuthParams(username, credential);
  params.set("type", type);
  params.set("size", String(size));

  const res = await apiPost(baseUrl, "getAlbumList2", params);
  if (!res.ok) throw new Error(`getAlbumList2 returned ${res.status}`);

  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { code: number; message: string };
      albumList2?: { album?: NavidromeAlbum[] };
    };
  };

  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Failed to fetch album list");
  }

  return response.albumList2?.album ?? [];
}

export interface NavidromeTrack {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  albumId: string;
  genre?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  duration?: number;
  coverArt?: string;
  starred?: string;
  path?: string;
  playCount?: number;
}

export function getStreamUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  trackId: string
): string {
  const params = buildAuthParams(username, credential);
  params.set("id", trackId);
  if (_streamMaxBitrate > 0) {
    params.set("maxBitRate", String(_streamMaxBitrate));
  }
  return `${normalizeUrl(baseUrl)}/rest/stream?${params.toString()}`;
}

export async function fetchAlbumTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  albumId: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", albumId);
  const res = await apiPost(baseUrl, "getAlbum", params);
  if (!res.ok) throw new Error(`getAlbum returned ${res.status}`);

  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { code: number; message: string };
      album?: { song?: NavidromeTrack[] };
    };
  };

  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Failed to fetch album tracks");
  }

  return response.album?.song ?? [];
}

export interface NavidromeStarred {
  song?: Array<{ id: string }>;
  album?: Array<{ id: string }>;
}

export async function fetchStarred2(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<NavidromeStarred> {
  const params = buildAuthParams(username, credential);
  const res = await apiPost(baseUrl, "getStarred2", params);
  if (!res.ok) throw new Error(`getStarred2 returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      starred2?: NavidromeStarred;
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getStarred2 failed");
  }
  return response.starred2 ?? {};
}

async function callSubsonicVoid(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  endpoint: string,
  extraParams: Record<string, string>
): Promise<void> {
  const params = buildAuthParams(username, credential);
  for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
  const res = await apiPost(baseUrl, endpoint, params);
  if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? `${endpoint} failed`);
  }
}

export function starTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "star.view", { id: nativeTrackId });
}

export function unstarTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "unstar.view", { id: nativeTrackId });
}

export function starAlbum(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeAlbumId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "star.view", { albumId: nativeAlbumId });
}

export function unstarAlbum(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeAlbumId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "unstar.view", { albumId: nativeAlbumId });
}

export function setRating(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  rating: number
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "setRating.view", { id: nativeTrackId, rating: String(rating) });
}

export async function fetchTrackRating(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string
): Promise<number> {
  const params = buildAuthParams(username, credential);
  params.set("id", nativeTrackId);
  try {
    const res = await apiPost(baseUrl, "getSong", params);
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      "subsonic-response": { status: string; song?: { userRating?: number } };
    };
    const resp = data["subsonic-response"];
    return resp.status === "ok" ? (resp.song?.userRating ?? 0) : 0;
  } catch {
    return 0;
  }
}

export interface NavidromePlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount: number;
}

export async function fetchPlaylists(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<NavidromePlaylist[]> {
  const params = buildAuthParams(username, credential);
  const res = await apiPost(baseUrl, "getPlaylists", params);
  if (!res.ok) throw new Error(`getPlaylists returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      playlists?: { playlist?: NavidromePlaylist[] };
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getPlaylists failed");
  }
  // Navidrome returns shared playlists twice (owner view + shared view); deduplicate by id.
  const raw = response.playlists?.playlist ?? [];
  const seen = new Set<string>();
  return raw.filter(pl => { if (seen.has(pl.id)) return false; seen.add(pl.id); return true; });
}

export async function fetchPlaylistTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  playlistId: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", playlistId);
  const res = await apiPost(baseUrl, "getPlaylist", params);
  if (!res.ok) throw new Error(`getPlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      playlist?: { entry?: NavidromeTrack[] };
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getPlaylist failed");
  }
  return response.playlist?.entry ?? [];
}

export async function createNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  name: string
): Promise<NavidromePlaylist> {
  const params = buildAuthParams(username, credential);
  params.set("name", name);
  const res = await apiPost(baseUrl, "createPlaylist", params);
  if (!res.ok) throw new Error(`createPlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      playlist?: NavidromePlaylist;
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "createPlaylist failed");
  }
  if (!response.playlist) throw new Error("createPlaylist returned no playlist");
  return response.playlist;
}

export function deleteNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "deletePlaylist", { id: nativePlaylistId });
}

export function addTrackToNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIdToAdd: nativeTrackId,
  });
}

export function removeTrackFromNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  songIndex: number
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIndexToRemove: String(songIndex),
  });
}

export function scrobbleTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  timestampMs: number
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "scrobble.view", {
    id: nativeTrackId,
    time: String(timestampMs),
    submission: "true",
  });
}

export function reportNowPlaying(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "scrobble.view", {
    id: nativeTrackId,
    submission: "false",
  });
}

export async function fetchAndStoreOpenSubsonicExtensions(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<string[]> {
  try {
    const params = buildAuthParams(username, credential);
    const res = await apiPost(baseUrl, "getOpenSubsonicExtensions", params);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      "subsonic-response": {
        status: string;
        openSubsonicExtensions?: Array<{ name: string; versions: number[] }>;
      };
    };
    const response = data["subsonic-response"];
    if (response.status !== "ok") return [];
    const extensions = (response.openSubsonicExtensions ?? []).map((e) => e.name);
    const { getDb } = await import("../db");
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('server.opensub_extensions', ?)",
      [JSON.stringify(extensions)]
    );
    return extensions;
  } catch {
    return [];
  }
}

export async function getStoredOpenSubsonicExtensions(): Promise<string[]> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = 'server.opensub_extensions'"
    );
    if (!rows[0]) return [];
    return JSON.parse(rows[0].value) as string[];
  } catch {
    return [];
  }
}

export function supportsOpenSubsonicExtension(extensions: string[], name: string): boolean {
  return extensions.includes(name);
}

function msToLrcTimestamp(ms: number): string {
  const totalSec = ms / 1000;
  const minutes = Math.floor(totalSec / 60);
  const seconds = (totalSec % 60).toFixed(2).padStart(5, "0");
  return `${String(minutes).padStart(2, "0")}:${seconds}`;
}

export async function fetchLyricsBySongId(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  trackId: string
): Promise<{ plain: string | null; synced: string | null } | null> {
  try {
    const params = buildAuthParams(username, credential);
    params.set("id", trackId);
    const res = await apiPost(baseUrl, "getLyricsBySongId", params);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      "subsonic-response": {
        status: string;
        lyricsList?: {
          structuredLyrics?: Array<{
            synced: boolean;
            line: Array<{ start?: number; value: string }>;
          }>;
        };
      };
    };
    const sr = data["subsonic-response"];
    if (sr.status !== "ok" || !sr.lyricsList?.structuredLyrics?.length) return null;

    const lyrics = sr.lyricsList.structuredLyrics;
    const syncedEntry = lyrics.find((l) => l.synced);
    const plainEntry = lyrics.find((l) => !l.synced) ?? lyrics[0];

    const synced = syncedEntry
      ? syncedEntry.line.map((l) =>
          l.start !== undefined ? `[${msToLrcTimestamp(l.start)}] ${l.value}` : l.value
        ).join("\n")
      : null;

    const plain = plainEntry
      ? plainEntry.line.map((l) => l.value).join("\n")
      : null;

    return { plain, synced };
  } catch {
    return null;
  }
}

export async function authenticate(
  baseUrl: string,
  username: string,
  password: string
): Promise<NavidromeCredential> {
  const salt = generateSalt();
  const token = md5(password + salt);
  const params = new URLSearchParams({ u: username, t: token, s: salt, v: "1.16.1", c: "canon", f: "json" });

  const res = await apiPost(baseUrl, "ping.view", params);
  if (!res.ok) {
    const origin = new URL(normalizeUrl(baseUrl)).origin;
    throw new Error(`Server returned ${res.status} — check URL (tried: ${origin}/rest/ping.view)`);
  }

  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { code: number; message: string };
    };
  };

  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Authentication failed");
  }

  return { type: "md5", token, salt };
}

export async function authenticateWithApiKey(
  baseUrl: string,
  username: string,
  apiKey: string
): Promise<NavidromeCredential> {
  const params = new URLSearchParams({ u: username, apiKey, v: "1.16.1", c: "canon", f: "json" });
  const res = await apiPost(baseUrl, "ping.view", params);
  if (!res.ok) {
    const origin = new URL(normalizeUrl(baseUrl)).origin;
    throw new Error(`Server returned ${res.status} — check URL (tried: ${origin}/rest/ping.view)`);
  }
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { code: number; message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Authentication failed");
  }
  return { type: "apikey", apiKey };
}
