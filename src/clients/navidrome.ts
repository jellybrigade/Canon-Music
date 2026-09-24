import { md5 } from "js-md5";
import { normalizeUrl, buildAuthParams, type NavidromeCredential } from "./navidromeUrls";
import { apiPost, callSubsonicVoid } from "./navidromeTransport";

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
  played?: string;
  releaseTypes?: string[];
  releaseType?: string;
}

function generateSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fetchAllAlbums(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  altUrl?: string
): Promise<NavidromeAlbum[]> {
  const PAGE_SIZE = 500;
  // A server that ignores `offset` answers every request with the same full page, so the
  // short-page exit never fires. Both guards below turn that hang into a failed sync.
  const MAX_ALBUMS = 500_000;
  const albums: NavidromeAlbum[] = [];
  let offset = 0;
  let previousFirstId: string | undefined;

  while (true) {
    const params = buildAuthParams(username, credential);
    params.set("type", "alphabeticalByName");
    params.set("size", String(PAGE_SIZE));
    params.set("offset", String(offset));

    const res = await apiPost(baseUrl, "getAlbumList2", params, altUrl);
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
    const firstId = page[0]?.id;
    if (firstId !== undefined && firstId === previousFirstId) {
      throw new Error(`getAlbumList2 ignored the offset: the page at ${offset} repeats the last`);
    }
    previousFirstId = firstId;
    albums.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset >= MAX_ALBUMS) {
      throw new Error(`getAlbumList2 exceeded the ${MAX_ALBUMS} album ceiling`);
    }
  }

  return albums;
}

export async function fetchAlbumListByType(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  type: "recent" | "frequent" | "newest",
  size = 20,
  altUrl?: string
): Promise<NavidromeAlbum[]> {
  const params = buildAuthParams(username, credential);
  params.set("type", type);
  params.set("size", String(size));

  const res = await apiPost(baseUrl, "getAlbumList2", params, altUrl);
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
  played?: string;
  bitRate?: number;
  suffix?: string;
  size?: number;
  replayGain?: {
    trackGain?: number;
    trackPeak?: number;
    albumGain?: number;
    albumPeak?: number;
  };
}

export async function fetchAlbumTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  albumId: string,
  altUrl?: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", albumId);
  const res = await apiPost(baseUrl, "getAlbum", params, altUrl);
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

// Navidrome forwards Last.fm's own "no image" placeholder verbatim, so reject it
// the same way clients/lastfm.ts does for images fetched directly from Last.fm.
const LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";

/** Server-side scraped artist portrait via getArtistInfo2 (no MBID or API key
 * needed, just the artist's native Navidrome id). Returns null on any failure
 * or when the server has no image on file. */
export async function getArtistImageFromServer(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  artistId: string,
  altUrl?: string
): Promise<string | null> {
  try {
    const params = buildAuthParams(username, credential);
    params.set("id", artistId);
    const res = await apiPost(baseUrl, "getArtistInfo2", params, altUrl);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      "subsonic-response": {
        status: string;
        artistInfo2?: { largeImageUrl?: string; mediumImageUrl?: string; smallImageUrl?: string };
      };
    };
    const info = data["subsonic-response"]?.artistInfo2;
    if (data["subsonic-response"]?.status !== "ok" || !info) return null;
    const url = info.largeImageUrl || info.mediumImageUrl || info.smallImageUrl;
    if (!url || url.includes(LASTFM_PLACEHOLDER_HASH)) return null;
    return url;
  } catch {
    return null;
  }
}

export interface NavidromeStarred {
  song?: Array<{ id: string }>;
  album?: Array<{ id: string }>;
}

export async function fetchStarred2(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  altUrl?: string
): Promise<NavidromeStarred> {
  const params = buildAuthParams(username, credential);
  const res = await apiPost(baseUrl, "getStarred2", params, altUrl);
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

/** The server's own identity, as far as the sync's skip fast-path is concerned. */
export interface NavidromeScanStatus {
  lastScan: string | null;
  songCount: number | null;
  serverVersion: string | null;
}

/**
 * `getScanStatus`, the cheapest evidence that the server's own ids may have moved.
 *
 * Some deployments restrict it to admins, so a failure means "no evidence" and the caller
 * has to fall back to probing ids directly - never to assuming nothing changed.
 */
export async function fetchScanStatus(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  altUrl?: string
): Promise<NavidromeScanStatus> {
  const params = buildAuthParams(username, credential);
  const res = await apiPost(baseUrl, "getScanStatus", params, altUrl);
  if (!res.ok) throw new Error(`getScanStatus returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      serverVersion?: string;
      scanStatus?: { lastScan?: string; count?: number };
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getScanStatus failed");
  }
  return {
    lastScan: response.scanStatus?.lastScan ?? null,
    songCount: response.scanStatus?.count ?? null,
    serverVersion: response.serverVersion ?? null,
  };
}

/**
 * "The requested data was not found." After a server-side id migration this is true of most
 * of the library at once, which is why several callers need to tell it from every other
 * rejection rather than treating any failure the same.
 */
export const SUBSONIC_NOT_FOUND = 70;

/**
 * Whether the server still knows a track id, for the sync's skip probe.
 *
 * Only a Subsonic error 70 counts as "gone": every other failure is the transport or the
 * account, which says nothing about the id and must not be read as evidence either way.
 */
export async function songExists(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  altUrl?: string
): Promise<boolean | null> {
  const params = buildAuthParams(username, credential);
  params.set("id", nativeTrackId);
  try {
    const res = await apiPost(baseUrl, "getSong", params, altUrl);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      "subsonic-response": { status: string; error?: { code?: number }; song?: { id?: string } };
    };
    const response = data["subsonic-response"];
    if (response.status === "ok") return response.song?.id !== undefined;
    return response.error?.code === SUBSONIC_NOT_FOUND ? false : null;
  } catch {
    return null;
  }
}

export function starTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "star.view", { id: nativeTrackId }, altUrl);
}

export function unstarTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "unstar.view", { id: nativeTrackId }, altUrl);
}

export function starAlbum(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeAlbumId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "star.view", { albumId: nativeAlbumId }, altUrl);
}

export function unstarAlbum(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeAlbumId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "unstar.view", { albumId: nativeAlbumId }, altUrl);
}

export function setRating(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  rating: number,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "setRating.view", { id: nativeTrackId, rating: String(rating) }, altUrl);
}

export async function fetchTrackRating(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  altUrl?: string
): Promise<number> {
  const params = buildAuthParams(username, credential);
  params.set("id", nativeTrackId);
  try {
    const res = await apiPost(baseUrl, "getSong", params, altUrl);
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

export function scrobbleTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  timestampMs: number,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "scrobble.view", {
    id: nativeTrackId,
    time: String(timestampMs),
    submission: "true",
  }, altUrl);
}

export function reportNowPlaying(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  altUrl?: string,
  signal?: AbortSignal
): Promise<void> {
  // The retry ladder makes this report race the next track's: aborting `signal` when the
  // track stops playing keeps a late retry from putting it back on the server.
  return callSubsonicVoid(baseUrl, username, credential, "scrobble.view", {
    id: nativeTrackId,
    submission: "false",
  }, altUrl, signal);
}

export async function fetchAndStoreOpenSubsonicExtensions(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  serverId: string,
  altUrl?: string
): Promise<string[]> {
  try {
    const params = buildAuthParams(username, credential);
    const res = await apiPost(baseUrl, "getOpenSubsonicExtensions", params, altUrl);
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
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [`server.opensub_extensions.${serverId}`, JSON.stringify(extensions)]
    );
    return extensions;
  } catch {
    return [];
  }
}

/** Null means the probe has not stored an answer yet (or could not be read), which is not
 *  the same as a server that answered and does not offer the extension. A caller deciding
 *  whether it may cache "found nothing" has to tell those apart. */
export async function getStoredOpenSubsonicExtensions(serverId: string): Promise<string[] | null> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = ?",
      [`server.opensub_extensions.${serverId}`]
    );
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value) as string[];
  } catch {
    return null;
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
  trackId: string,
  altUrl?: string
): Promise<{ plain: string | null; synced: string | null } | null> {
  try {
    const params = buildAuthParams(username, credential);
    params.set("id", trackId);
    const res = await apiPost(baseUrl, "getLyricsBySongId", params, altUrl);
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

// The URL apiPost actually contacted, not its origin: a subpath install would otherwise
// be told to check an address nothing ever asked for, and `new URL` on a typo'd host threw
// its own TypeError over the message written for exactly that user.
function pingFailureMessage(baseUrl: string, status: number): string {
  return `Server returned ${status}. Check URL (tried: ${normalizeUrl(baseUrl)}/rest/ping.view)`;
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
    throw new Error(pingFailureMessage(baseUrl, res.status));
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

export interface SavedPlayQueue {
  trackIds: string[];
  currentId: string | null;
  positionMs: number;
}

export async function savePlayQueue(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  trackIds: string[],
  currentId: string | null,
  positionMs: number,
  altUrl?: string
): Promise<void> {
  if (trackIds.length === 0) return;
  const params = buildAuthParams(username, credential);
  for (const id of trackIds) params.append("id", id);
  if (currentId) params.set("current", currentId);
  params.set("position", String(Math.round(positionMs)));
  const res = await apiPost(baseUrl, "savePlayQueue", params, altUrl);
  if (!res.ok) return;
}

export async function getPlayQueue(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  altUrl?: string
): Promise<SavedPlayQueue | null> {
  try {
    const params = buildAuthParams(username, credential);
    const res = await apiPost(baseUrl, "getPlayQueue", params, altUrl);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      "subsonic-response": {
        status: string;
        playQueue?: {
          entry?: Array<{ id: string }>;
          current?: string | number;
          position?: number;
        };
      };
    };
    const response = data["subsonic-response"];
    if (response.status !== "ok" || !response.playQueue) return null;
    const queue = response.playQueue;
    const trackIds = (queue.entry ?? []).map((e) => e.id);
    if (trackIds.length === 0) return null;
    return {
      trackIds,
      currentId: queue.current != null ? String(queue.current) : null,
      positionMs: queue.position ?? 0,
    };
  } catch {
    return null;
  }
}

export async function authenticateWithApiKey(
  baseUrl: string,
  username: string,
  apiKey: string
): Promise<NavidromeCredential> {
  const params = new URLSearchParams({ u: username, apiKey, v: "1.16.1", c: "canon", f: "json" });
  const res = await apiPost(baseUrl, "ping.view", params);
  if (!res.ok) {
    throw new Error(pingFailureMessage(baseUrl, res.status));
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
