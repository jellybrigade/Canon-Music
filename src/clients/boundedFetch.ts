export const REQUEST_TIMEOUT_MS = 12_000;

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** `fetch` with a deadline on the headers and, separately, on reading the body. The returned
 *  Response is already buffered, so `json()`/`blob()` on it can't stall. */
export async function boundedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // Manual AbortController rather than AbortSignal.timeout: the latter is missing on
  // the older WebKitGTK builds Canon still runs against on Linux.
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  callerSignal?.addEventListener("abort", abortFromCaller);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Rearm across the body read: headers arriving doesn't bound the transfer.
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const body = await res.arrayBuffer();
    return new Response(NULL_BODY_STATUSES.has(res.status) ? null : body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
