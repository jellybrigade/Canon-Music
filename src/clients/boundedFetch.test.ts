import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedFetch, REQUEST_TIMEOUT_MS } from "./boundedFetch";

function abortableNever(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("boundedFetch", () => {
  it("rejects when the server never sends headers", async () => {
    vi.stubGlobal("fetch", vi.fn(abortableNever));
    const pending = expect(boundedFetch("https://example.test")).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
  });

  it("rejects when the body stalls after headers arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }),
    );
    const pending = expect(boundedFetch("https://example.test")).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
  });

  it("aborts when the caller's signal aborts", async () => {
    vi.stubGlobal("fetch", vi.fn(abortableNever));
    const caller = new AbortController();
    const pending = expect(boundedFetch("https://example.test", { signal: caller.signal })).rejects.toThrow("aborted");
    caller.abort();
    await pending;
  });

  it("hands back status and a body that can still be read as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response('{"a":1}', { status: 201 }))),
    );
    const res = await boundedFetch("https://example.test");
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ a: 1 });
  });

  it("keeps binary bodies intact", async () => {
    const bytes = new Uint8Array([0, 255, 128, 7]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(bytes, { status: 200 }))),
    );
    const res = await boundedFetch("https://example.test");
    expect(new Uint8Array(await (await res.blob()).arrayBuffer())).toEqual(bytes);
  });

  it("accepts a null-body status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    const res = await boundedFetch("https://example.test");
    expect(res.status).toBe(204);
  });

  it("disarms its timer once the response is read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok"))),
    );
    await boundedFetch("https://example.test");
    expect(vi.getTimerCount()).toBe(0);
  });
});
