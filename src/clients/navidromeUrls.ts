import { invoke } from "@tauri-apps/api/core";
import { lastAnsweringRoute } from "../lib/transportHealth";

let _streamMaxBitrate = 0;
let _coverServerReady = false;

export function initCoverServer(): void {
  _coverServerReady = true;
}

/** True once the Rust `cover://` scheme handler has a confirmed proxy config; artist portraits wait for it. */
export function isCoverServerReady(): boolean {
  return _coverServerReady;
}

// Server id -> album key -> when its chosen cover was picked. The webview keeps an image by URL
// for the life of the process, so a cover served in place of the server's must also change the URL.
let coverRevisions = new Map<string, ReadonlyMap<string, number>>();
const coverRevisionListeners = new Set<() => void>();

function announceCoverRevisions(): void {
  for (const listener of coverRevisionListeners) listener();
}

/** `al-{id}_{stamp}` or `al-{id}` -> `{id}`, the Navidrome album id; per-file ids have none. Mirrors `cover_override.rs`. */
export function albumKeyOfCoverId(coverArtId: string): string | null {
  if (!coverArtId.startsWith("al-")) return null;
  const rest = coverArtId.slice(3);
  const stamp = rest.lastIndexOf("_");
  const key = stamp >= 0 && /^[0-9a-fA-F]+$/.test(rest.slice(stamp + 1)) ? rest.slice(0, stamp) : rest;
  return key === "" ? null : key;
}

export function setCoverRevision(serverId: string, albumKey: string, revision: number | null): void {
  const forServer = new Map(coverRevisions.get(serverId));
  if (revision === null) forServer.delete(albumKey);
  else forServer.set(albumKey, revision);
  coverRevisions = new Map(coverRevisions).set(serverId, forServer);
  announceCoverRevisions();
}

/** Replaces every revision with `serverId`'s; Rust serves only the active server's choices. */
export function replaceCoverRevisions(serverId: string | null, revisions: ReadonlyMap<string, number>): void {
  coverRevisions = serverId === null ? new Map() : new Map([[serverId, new Map(revisions)]]);
  announceCoverRevisions();
}

export function subscribeCoverRevisions(listener: () => void): () => void {
  coverRevisionListeners.add(listener);
  return () => coverRevisionListeners.delete(listener);
}

export async function updateCoverProxyConfig({
  serverId,
  baseUrl,
  altUrl,
  username,
  credential,
}: {
  serverId: string;
  baseUrl: string;
  altUrl: string | null;
  username: string;
  credential: NavidromeCredential;
}): Promise<void> {
  const params = buildAuthParams(username, credential);
  await invoke("set_cover_proxy_config", {
    serverId,
    baseUrl: normalizeUrl(baseUrl),
    altUrl: altUrl ? normalizeUrl(altUrl) : null,
    authParams: params.toString(),
  });
}
export function setStreamMaxBitrate(kbps: number): void {
  _streamMaxBitrate = kbps;
}

export type NavidromeCredential = { type: "md5"; token: string; salt: string } | { type: "apikey"; apiKey: string };

export function normalizeUrl(url: string): string {
  // Strip trailing slashes and accidental /rest suffix
  return url.replace(/\/+$/, "").replace(/\/rest$/, "");
}

export function buildAuthParams(username: string, credential: NavidromeCredential): URLSearchParams {
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

/** Navidrome sends the stored image unscaled for size 0. */
export const ORIGINAL_COVER_SIZE = 0;

function coverSizeParam(size: number): number {
  if (!Number.isFinite(size)) return 300;
  if (size === ORIGINAL_COVER_SIZE) return ORIGINAL_COVER_SIZE;
  return Math.max(1, Math.round(size));
}

const COVER_URL_PREFIX = "cover://localhost/cover/";

/** Sets a `cover://` album URL's revision to its server's current one; URLs kept in queues and query data predate later choices. */
export function withCoverRevision(url: string): string {
  if (!url.startsWith(COVER_URL_PREFIX) || (coverRevisions.size === 0 && !url.includes("v="))) return url;
  const queryStart = url.indexOf("?");
  const path = queryStart >= 0 ? url.slice(0, queryStart) : url;
  const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart + 1) : "");
  const [serverSegment = "", coverSegment = ""] = path.slice(COVER_URL_PREFIX.length).split("/");
  const albumKey = albumKeyOfCoverId(decodeURIComponent(coverSegment));
  const revision = albumKey === null ? undefined : coverRevisions.get(decodeURIComponent(serverSegment))?.get(albumKey);
  params.delete("v");
  if (revision !== undefined) params.set("v", String(revision));
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

/** Always a `cover://` URL naming its server: Rust holds each server's address and credential,
 * waits for one not handed over yet, and caches per server. */
export function getCoverArtUrl(serverId: string, coverArtId: string, size = 300): string {
  // Rust falls back to 300 for a size it cannot parse, but caches under the string it was
  // handed, so a fractional or negative size fragments the disk cache and every memo key
  // built from the URL. Callers compute sizes (`size * 2`).
  const px = coverSizeParam(size);
  return withCoverRevision(
    `${COVER_URL_PREFIX}${encodeURIComponent(serverId)}/${encodeURIComponent(coverArtId)}?size=${px}`,
  );
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

export function getStreamUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  trackId: string,
): string {
  const params = buildAuthParams(username, credential);
  params.set("id", trackId);
  if (_streamMaxBitrate > 0) {
    params.set("maxBitRate", String(_streamMaxBitrate));
  }
  // Built at play time, so a stream follows whichever of the server's addresses last
  // answered an API call; with only the alternate URL reachable, the primary would never play.
  const server = normalizeUrl(baseUrl);
  return `${lastAnsweringRoute(server) ?? server}/rest/stream?${params.toString()}`;
}
