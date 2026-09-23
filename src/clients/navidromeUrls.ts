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

export function normalizeUrl(url: string): string {
  // Strip trailing slashes and accidental /rest suffix
  return url.replace(/\/+$/, "").replace(/\/rest$/, "");
}

export function buildAuthParams(
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

export function getCoverArtUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  coverArtId: string,
  size = 300
): string {
  // Rust falls back to 300 for a size it cannot parse, but caches under `{id}:{size}`
  // with the string it was handed, so a fractional or negative size fragments the disk
  // cache and every memo key built from the URL. Callers compute sizes (`size * 2`).
  const px = Number.isFinite(size) ? Math.max(1, Math.round(size)) : 300;
  if (_coverServerReady) {
    return `cover://localhost/cover/${encodeURIComponent(coverArtId)}?size=${px}`;
  }
  const params = buildAuthParams(username, credential);
  params.set("id", coverArtId);
  params.set("size", String(px));
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
