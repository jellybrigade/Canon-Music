import { invoke } from "@tauri-apps/api/core";
import { lastAnsweringRoute } from "../lib/transportHealth";

let _streamMaxBitrate = 0;
let _coverServerReady = false;

export function initCoverServer(): void {
  _coverServerReady = true;
}

/** True once the Rust `cover://` scheme handler has a confirmed proxy config. */
export function isCoverServerReady(): boolean {
  return _coverServerReady;
}

// Album key -> when its chosen cover was picked. The webview keeps an image by URL for the life
// of the process, so a cover served in place of the server's must also change the URL.
let coverRevisions = new Map<string, number>();
let coverRevisionsVersion = 0;
const coverRevisionListeners = new Set<() => void>();

function announceCoverRevisions(): void {
  coverRevisionsVersion += 1;
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

export function setCoverRevision(albumKey: string, revision: number | null): void {
  coverRevisions = new Map(coverRevisions);
  if (revision === null) coverRevisions.delete(albumKey);
  else coverRevisions.set(albumKey, revision);
  announceCoverRevisions();
}

export function replaceCoverRevisions(revisions: ReadonlyMap<string, number>): void {
  coverRevisions = new Map(revisions);
  announceCoverRevisions();
}

export function subscribeCoverRevisions(listener: () => void): () => void {
  coverRevisionListeners.add(listener);
  return () => coverRevisionListeners.delete(listener);
}

export function getCoverRevisionsVersion(): number {
  return coverRevisionsVersion;
}

export async function updateCoverProxyConfig(
  baseUrl: string,
  altUrl: string | null,
  username: string,
  credential: NavidromeCredential,
): Promise<void> {
  const params = buildAuthParams(username, credential);
  await invoke("set_cover_proxy_config", {
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

export function getCoverArtUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  coverArtId: string,
  size = 300,
): string {
  // Rust falls back to 300 for a size it cannot parse, but caches under `{id}:{size}`
  // with the string it was handed, so a fractional or negative size fragments the disk
  // cache and every memo key built from the URL. Callers compute sizes (`size * 2`).
  const px = coverSizeParam(size);
  if (_coverServerReady) {
    const albumKey = albumKeyOfCoverId(coverArtId);
    const revision = albumKey === null ? undefined : coverRevisions.get(albumKey);
    const version = revision === undefined ? "" : `&v=${revision}`;
    return `cover://localhost/cover/${encodeURIComponent(coverArtId)}?size=${px}${version}`;
  }
  const params = buildAuthParams(username, credential);
  params.set("id", coverArtId);
  params.set("size", String(px));
  const server = normalizeUrl(baseUrl);
  return `${lastAnsweringRoute(server) ?? server}/rest/getCoverArt?${params.toString()}`;
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
