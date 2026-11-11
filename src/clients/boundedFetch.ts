import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { redactCredentials } from "../lib/redactCredentials";

export const REQUEST_TIMEOUT_MS = 12_000;
/** An upload's bytes all leave before its headers can come back, so its header deadline covers the transfer. */
export const UPLOAD_TIMEOUT_MS = 60_000;

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface BoundedFetchOptions {
  /** Deadline for the response headers. The body is bounded per chunk by `REQUEST_TIMEOUT_MS`. */
  headersTimeoutMs?: number;
}

/** `fetch` with a deadline on the headers and a stall deadline on each chunk of the body. The
 *  returned Response is already buffered, so `json()`/`blob()` on it can't stall. */
export function boundedFetch(
  url: string,
  init: RequestInit = {},
  options: BoundedFetchOptions = {},
): Promise<Response> {
  return boundedRequest((target, request) => fetch(target, request), url, init, options);
}

/** `boundedFetch` through the native client: for headers the webview won't send (User-Agent) and
 *  hosts its CORS rules block. */
export async function boundedNativeFetch(
  url: string,
  init: RequestInit = {},
  options: BoundedFetchOptions = {},
): Promise<Response> {
  try {
    return await boundedRequest(tauriFetch, url, init, options);
  } catch (err) {
    throw await explainSendFailure(url, err);
  }
}

const SEND_FAILURE = "error sending request";

// The native client passes on only reqwest's outermost message, the same for an untrusted
// certificate, a failed lookup and a refused connection; Rust repeats the request to read which.
async function explainSendFailure(url: string, err: unknown): Promise<unknown> {
  if (typeof err !== "string" || !err.startsWith(SEND_FAILURE)) return err;
  try {
    return (await invoke<string | null>("diagnose_request", { url })) ?? err;
  } catch {
    return err;
  }
}

async function boundedRequest(
  transport: Transport,
  url: string,
  init: RequestInit,
  { headersTimeoutMs = REQUEST_TIMEOUT_MS }: BoundedFetchOptions,
): Promise<Response> {
  // Manual AbortController rather than AbortSignal.timeout: the latter is missing on
  // the older WebKitGTK builds Canon still runs against on Linux.
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // Cancelling the reader too ends a body read whose transport doesn't honour the signal.
  const abort = () => {
    controller.abort();
    reader?.cancel().catch(() => {});
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOutAfterMs: number | null = null;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOutAfterMs = ms;
      abort();
    }, ms);
  };
  const callerSignal = init.signal;
  if (callerSignal?.aborted) controller.abort();
  callerSignal?.addEventListener("abort", abort);
  try {
    arm(headersTimeoutMs);
    const res = await transport(url, { ...init, signal: controller.signal });
    const chunks: Uint8Array[] = [];
    if (res.body && !NULL_BODY_STATUSES.has(res.status)) {
      reader = res.body.getReader();
      for (;;) {
        arm(REQUEST_TIMEOUT_MS);
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw controller.signal.reason;
        if (done) break;
        chunks.push(value);
      }
    }
    return new Response(NULL_BODY_STATUSES.has(res.status) ? null : concat(chunks), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    // The native client reports its own abort as "Request canceled", which reads as if someone stopped it.
    if (timedOutAfterMs !== null) throw new DOMException(`timed out after ${timedOutAfterMs / 1000}s`, "AbortError");
    throw withoutCredentials(err);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abort);
  }
}

// Transport errors quote the URL, key included, and end up on screen and in logs. The type is kept:
// callers branch on `TypeError` and `AbortError`, and the native client rejects with a bare string.
function withoutCredentials(err: unknown): unknown {
  if (typeof err === "string") return redactCredentials(err);
  if (err instanceof Error) {
    const message = redactCredentials(err.message);
    if (message !== err.message) Object.defineProperty(err, "message", { value: message, configurable: true });
  }
  return err;
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
