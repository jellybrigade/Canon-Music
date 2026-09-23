import {
  noteTransportTimeout,
  recordTransportSuccess,
  transportStallNotice,
  TransportStalledError,
} from "../lib/transportHealth";
import { normalizeUrl, buildAuthParams, type NavidromeCredential } from "./navidromeUrls";

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

function isRetriableEndpoint(endpoint: string, params: URLSearchParams): boolean {
  // Call sites are inconsistent about the ".view" suffix, so compare on the bare name.
  const name = endpoint.replace(/\.view$/, "");
  // scrobble carries two different writes. `submission=true` appends a play and cannot be
  // repeated; `submission=false` only sets which track is on, so it is as safe to repeat
  // as a star, and giving it one shot leaves the server saying nothing is playing for the
  // rest of the track whenever a single request is lost.
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

  // Every request stalls identically when the fault is this machine's HTTP layer rather
  // than the server, so the ladder below would spend 37s per call for as long as it lasts.
  // Health is per server: one stalled server must not speak for another, least of all
  // in a message that names an address the caller never asked about.
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

  // Opaque fetch rejections ("Load failed") are useless in a log, so name the endpoint
  // and the attempt count that were actually burned. A ladder spent entirely on timeouts
  // also feeds the breaker, which answers with a cause once it has seen enough to say one.
  // Only a full ladder is the ~75s of evidence the threshold is written around. A
  // single-shot write times out after 12s, and the scrobble queue drains in bursts of
  // them, so letting those open the breaker would trip it on a third of the evidence.
  const cause = lastWasTimeout && retriable ? await noteTransportTimeout(server) : null;
  throw new Error(
    `${endpoint} failed after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""}: ${lastFailure}` +
      (cause ? `. ${cause}` : "")
  );
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
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { code?: number; message?: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new SubsonicError(endpoint, response.error?.code ?? null, response.error?.message);
  }
}
