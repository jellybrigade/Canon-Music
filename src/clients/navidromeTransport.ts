import {
  noteTransportTimeout,
  recordTransportSuccess,
  transportStallNotice,
  TransportStalledError,
} from "../lib/transportHealth";
import { noteEnvelope, type SubsonicEnvelope } from "../lib/credentialRejections";
import { normalizeUrl, buildAuthParams, type NavidromeCredential } from "./navidromeUrls";

// Stuck DNS resolution (stale systemd-resolved entry) hangs fetch ~25s then rejects
// with an opaque "Load failed"; cap well under that and retry instead of aborting.
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

/** A timed-out request may have applied before the response was lost, so retrying these would
 *  scrobble twice or duplicate a playlist; everything else is a read or an idempotent write. */
const NON_IDEMPOTENT_ENDPOINTS = new Set([
  "scrobble",
  "createPlaylist",
  "updatePlaylist",
  "deletePlaylist",
]);

function isRetriableEndpoint(endpoint: string, params: URLSearchParams): boolean {
  // Call sites are inconsistent about the ".view" suffix, so compare on the bare name.
  const name = endpoint.replace(/\.view$/, "");
  // `submission=true` appends a play and cannot be repeated; `submission=false` only sets
  // now-playing, so it's as safe to repeat as a star.
  if (name === "scrobble") return params.get("submission") === "false";
  return !NON_IDEMPOTENT_ENDPOINTS.has(name);
}

/** The one endpoint a user runs on purpose to ask whether a server is up. Refusing it
 *  while the breaker is open would take away the only way to find out that a fixed
 *  network is fixed, so it always gets its ladder. */
function isLivenessCheck(endpoint: string): boolean {
  return endpoint.replace(/\.view$/, "") === "ping";
}

async function fetchWithTimeout(url: string, body: string, signal?: AbortSignal): Promise<Response> {
  // Manual AbortController rather than AbortSignal.timeout: the latter is missing on
  // the older WebKitGTK builds Canon still runs against on Linux.
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    // Rearm the abort across the body read: headers arriving doesn't bound the transfer, and
    // a stall mid-body would otherwise hang `res.json()` forever.
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
    signal?.removeEventListener("abort", abortFromCaller);
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

export async function apiPost(
  baseUrl: string,
  endpoint: string,
  params: URLSearchParams,
  altUrl?: string,
  signal?: AbortSignal
): Promise<Response> {
  const body = params.toString();
  const server = normalizeUrl(baseUrl);
  const urls = [`${server}/rest/${endpoint}`];
  // The alt URL (typically a LAN address for the same server) is tried within every
  // attempt, not only on the first, since either route can be the one that is stalling.
  if (altUrl) urls.push(`${normalizeUrl(altUrl)}/rest/${endpoint}`);

  // Health is tracked per server so a stalled one can't speak for another or name an
  // address the caller never asked about.
  const stalled = isLivenessCheck(endpoint) ? null : transportStallNotice(server);
  if (stalled) throw new TransportStalledError(`${endpoint} not attempted: ${stalled}`);

  let lastFailure = "unknown error";
  let lastWasTimeout = false;
  // A write that cannot be safely repeated gets exactly one shot, full stop. Both routes
  // are the same Navidrome, and fetch cannot say whether a rejected request reached it,
  // so any rejection has to be treated as "may already have been applied".
  const retriable = isRetriableEndpoint(endpoint, params);
  const maxAttempts = retriable ? MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const url of urls) {
      // A withdrawn request is neither a failure nor a timeout, so it feeds nothing.
      // Not `throwIfAborted`, which older WebKitGTK builds lack.
      if (signal?.aborted) throw new DOMException(`${endpoint} withdrawn`, "AbortError");
      try {
        const res = await fetchWithTimeout(url, body, signal);
        recordTransportSuccess(server);
        if (retriable && isRetriableStatus(res.status) && attempt < maxAttempts) {
          lastFailure = `HTTP ${res.status}`;
          continue;
        }
        return res;
      } catch (err) {
        if (signal?.aborted) throw new DOMException(`${endpoint} withdrawn`, "AbortError");
        lastFailure = describeError(err);
        lastWasTimeout = isTimeout(err);
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

  // Name the endpoint and attempt count so "Load failed" is useful in a log; only a
  // full retry ladder (not a single-shot write) feeds the breaker's timeout evidence.
  const cause = lastWasTimeout && retriable ? await noteTransportTimeout(server) : null;
  throw new Error(
    `${endpoint} failed after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""}: ${lastFailure}` +
      (cause ? `. ${cause}` : "")
  );
}

/** A rejection the server itself issued (Subsonic error code), not a transport failure worth retrying. */
export class SubsonicError extends Error {
  readonly code: number | null;
  constructor(endpoint: string, code: number | null, message?: string) {
    super(message ?? `${endpoint} failed${code === null ? "" : ` with code ${code}`}`);
    this.name = "SubsonicError";
    this.code = code;
  }
}

/** Throws for a refused request, and tells the credential record what the server said
 *  either way, so a password rotated on the server shows up as that rather than as every
 *  request failing. Login pings skip this: they report a refusal of what was just typed. */
export function checkEnvelope(
  baseUrl: string,
  endpoint: string,
  response: SubsonicEnvelope,
  fallbackMessage?: string
): void {
  noteEnvelope(baseUrl, response);
  if (response.status !== "ok") {
    throw new SubsonicError(endpoint, response.error?.code ?? null, response.error?.message ?? fallbackMessage);
  }
}

export async function callSubsonicVoid(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  endpoint: string,
  extraParams: Record<string, string>,
  altUrl?: string,
  signal?: AbortSignal
): Promise<void> {
  const params = buildAuthParams(username, credential);
  for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
  const res = await apiPost(baseUrl, endpoint, params, altUrl, signal);
  if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
  const data = (await res.json()) as { "subsonic-response": SubsonicEnvelope };
  checkEnvelope(baseUrl, endpoint, data["subsonic-response"]);
}
