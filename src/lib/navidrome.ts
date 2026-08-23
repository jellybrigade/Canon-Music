import { md5 } from "js-md5";
import { invoke } from "@tauri-apps/api/core";

let _streamMaxBitrate = 0;
let _coverServerReady = false;

export function initCoverServer(): void {
  _coverServerReady = true;
}

/** True once the Rust `cover://` scheme handler has a confirmed proxy config. */
export function isCoverServerReady(): boolean {
  return _coverServerReady;
}

export async function updateCoverProxyConfig(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<void> {
  const params = buildAuthParams(username, credential);
  await invoke("set_cover_proxy_config", {
    baseUrl: normalizeUrl(baseUrl),
    authParams: params.toString(),
  });
}
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
  played?: string;
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

// A request stuck in DNS resolution is the dominant transient failure mode on Linux:
// a stale/unreachable resolver entry (corporate VPN nameserver left in the global
// systemd-resolved scope, for instance) makes every in-flight fetch hang together for
// ~25s and then reject with an opaque "Load failed" TypeError, even though the network
// is up and the next attempt succeeds off the resolver cache. Cap each attempt well
// under that ceiling and retry, so a resolver hiccup costs a few seconds instead of
// aborting a whole sync.
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Server-side conditions worth another attempt. Anything else (4xx, 500) is a real
 *  answer and gets handed back to the caller unchanged. */
function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Endpoints that change server state in a way a second call would compound: a timed-out
 *  request may well have been applied before the response was lost, so retrying it would
 *  scrobble a play twice, create a duplicate playlist, or add the same track again.
 *  Everything else here is either a read or an idempotent set-to-this-value write
 *  (star, unstar, setRating, savePlayQueue), which is safe to repeat. */
const NON_IDEMPOTENT_ENDPOINTS = new Set([
  "scrobble",
  "createPlaylist",
  "updatePlaylist",
  "deletePlaylist",
]);

function isRetriableEndpoint(endpoint: string): boolean {
  // Call sites are inconsistent about the ".view" suffix, so compare on the bare name.
  return !NON_IDEMPOTENT_ENDPOINTS.has(endpoint.replace(/\.view$/, ""));
}

async function fetchWithTimeout(url: string, body: string): Promise<Response> {
  // Manual AbortController rather than AbortSignal.timeout: the latter is missing on
  // the older WebKitGTK builds Canon still runs against on Linux.
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    // fetch resolves once the headers land, so the body is still streaming here and the
    // abort has to stay armed across the read: a connection dying mid-transfer would
    // otherwise leave the caller's `res.json()` pending forever, with nothing for the
    // retry loop to catch and no terminal state for the sync above it. Every caller
    // parses JSON, so buffering the body costs nothing and leaves them unchanged.
    //
    // Rearmed rather than left running: the ceiling exists to bound a stall, not the
    // total size of an answer, and a 500-album page over a slow link can legitimately
    // take longer to transfer than the handshake left of the original budget.
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const text = await res.text();
    // A null-body status (204/304) rejects a non-null body, and "" is non-null.
    return new Response(text === "" ? null : text, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function describeError(err: unknown): string {
  if (isTimeout(err)) {
    return `timed out after ${REQUEST_TIMEOUT_MS}ms`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function apiPost(
  baseUrl: string,
  endpoint: string,
  params: URLSearchParams,
  altUrl?: string
): Promise<Response> {
  const body = params.toString();
  const urls = [`${normalizeUrl(baseUrl)}/rest/${endpoint}`];
  // The alt URL (typically a LAN address for the same server) is tried within every
  // attempt, not only on the first, since either route can be the one that is stalling.
  if (altUrl) urls.push(`${normalizeUrl(altUrl)}/rest/${endpoint}`);

  let lastFailure = "unknown error";
  // A write that cannot be safely repeated gets exactly one shot, full stop. Both routes
  // are the same Navidrome, and fetch cannot say whether a rejected request reached it,
  // so any rejection has to be treated as "may already have been applied".
  const retriable = isRetriableEndpoint(endpoint);
  const maxAttempts = retriable ? MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(url, body);
        if (retriable && isRetriableStatus(res.status) && attempt < maxAttempts) {
          lastFailure = `HTTP ${res.status}`;
          continue;
        }
        return res;
      } catch (err) {
        lastFailure = describeError(err);
        // fetch rejects identically whether the request never left the machine or was
        // applied and lost its response (the common Linux resolver stall surfaces as an
        // opaque TypeError, not an AbortError), so a non-idempotent write stops here.
        if (!retriable) break;
      }
    }
    if (attempt < maxAttempts) {
      await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  // Opaque fetch rejections ("Load failed") are useless in a log, so name the endpoint
  // and the attempt count that were actually burned.
  throw new Error(
    `${endpoint} failed after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""}: ${lastFailure}`
  );
}

export function getCoverArtUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  coverArtId: string,
  size = 300
): string {
  if (_coverServerReady) {
    return `cover://localhost/cover/${encodeURIComponent(coverArtId)}?size=${size}`;
  }
  const params = buildAuthParams(username, credential);
  params.set("id", coverArtId);
  params.set("size", String(size));
  return `${normalizeUrl(baseUrl)}/rest/getCoverArt?${params.toString()}`;
}

/** Routes an external artist portrait URL (Last.fm/Wikidata) through the Rust
 * `cover://` scheme handler so it's fetched once and cached, instead of hitting the
 * external host on every render. Falls back to the raw URL if not ready yet. */
export function getArtistImageUrl(sourceUrl: string): string {
  if (_coverServerReady) {
    return `cover://localhost/artist-image/${encodeURIComponent(sourceUrl)}`;
  }
  return sourceUrl;
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
// the same way lib/lastfm.ts does for images fetched directly from Last.fm.
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

/**
 * A rejection the server itself issued, as opposed to a transport failure.
 * The distinction matters to anything that retries: a transport failure is worth
 * trying again later, whereas a Subsonic error code means the request was received
 * and understood and will be refused identically forever (code 70, "not found") or
 * until something else changes (code 40, bad credentials).
 */
export class SubsonicError extends Error {
  readonly code: number | null;
  constructor(endpoint: string, code: number | null, message?: string) {
    super(message ?? `${endpoint} failed${code === null ? "" : ` with code ${code}`}`);
    this.name = "SubsonicError";
    this.code = code;
  }
}

async function callSubsonicVoid(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  endpoint: string,
  extraParams: Record<string, string>,
  altUrl?: string
): Promise<void> {
  const params = buildAuthParams(username, credential);
  for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
  const res = await apiPost(baseUrl, endpoint, params, altUrl);
  if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { code?: number; message?: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new SubsonicError(endpoint, response.error?.code ?? null, response.error?.message);
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

export interface NavidromePlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount: number;
  coverArt?: string;
}

export async function fetchPlaylists(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  altUrl?: string
): Promise<NavidromePlaylist[]> {
  const params = buildAuthParams(username, credential);
  const res = await apiPost(baseUrl, "getPlaylists", params, altUrl);
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
  playlistId: string,
  altUrl?: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", playlistId);
  const res = await apiPost(baseUrl, "getPlaylist", params, altUrl);
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
  name: string,
  altUrl?: string
): Promise<NavidromePlaylist> {
  const params = buildAuthParams(username, credential);
  params.set("name", name);
  const res = await apiPost(baseUrl, "createPlaylist", params, altUrl);
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
  nativePlaylistId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "deletePlaylist", { id: nativePlaylistId }, altUrl);
}

export function addTrackToNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIdToAdd: nativeTrackId,
  }, altUrl);
}

export async function addTracksToNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackIds: string[],
  altUrl?: string
): Promise<void> {
  const params = buildAuthParams(username, credential);
  params.set("playlistId", nativePlaylistId);
  for (const id of nativeTrackIds) params.append("songIdToAdd", id);
  const res = await apiPost(baseUrl, "updatePlaylist", params, altUrl);
  if (!res.ok) throw new Error(`updatePlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "updatePlaylist failed");
  }
}

export async function updateNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  name: string,
  comment?: string,
  altUrl?: string
): Promise<void> {
  const extra: Record<string, string> = { playlistId: nativePlaylistId, name };
  if (comment !== undefined) extra["comment"] = comment;
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", extra, altUrl);
}

export function removeTrackFromNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  songIndex: number,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIndexToRemove: String(songIndex),
  }, altUrl);
}

export async function replaceNavidromePlaylistTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackIds: string[],
  currentTrackCount: number,
  altUrl?: string
): Promise<void> {
  const params = buildAuthParams(username, credential);
  params.set("playlistId", nativePlaylistId);
  for (let i = 0; i < currentTrackCount; i++) params.append("songIndexToRemove", String(i));
  for (const id of nativeTrackIds) params.append("songIdToAdd", id);
  const res = await apiPost(baseUrl, "updatePlaylist", params, altUrl);
  if (!res.ok) throw new Error(`updatePlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "updatePlaylist failed");
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
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "scrobble.view", {
    id: nativeTrackId,
    submission: "false",
  }, altUrl);
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

export async function getStoredOpenSubsonicExtensions(serverId: string): Promise<string[]> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = ?",
      [`server.opensub_extensions.${serverId}`]
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
    throw new Error(`Server returned ${res.status}. Check URL (tried: ${origin}/rest/ping.view)`);
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
    const origin = new URL(normalizeUrl(baseUrl)).origin;
    throw new Error(`Server returned ${res.status}. Check URL (tried: ${origin}/rest/ping.view)`);
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
