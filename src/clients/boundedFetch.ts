import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

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
export function boundedNativeFetch(
  url: string,
  init: RequestInit = {},
  options: BoundedFetchOptions = {},
): Promise<Response> {
  return boundedRequest(tauriFetch, url, init, options);
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
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(abort, ms);
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
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abort);
  }
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
