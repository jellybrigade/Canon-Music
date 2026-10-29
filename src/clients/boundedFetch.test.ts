import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { boundedFetch, boundedNativeFetch, REQUEST_TIMEOUT_MS } from "./boundedFetch";

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
  vi.mocked(tauriFetch).mockReset();
});

/** A body that sends one byte every `gapMs`, `count` times; it errors on `signal` only if given one. */
function tricklingBody(gapMs: number, count: number, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
    pull(controller) {
      return new Promise((resolve) => {
        setTimeout(() => {
          if (sent === count) controller.close();
          else controller.enqueue(new Uint8Array([sent++]));
          resolve();
        }, gapMs);
      });
    },
  });
}

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

  it("lets a slow body finish while it keeps arriving", async () => {
    const gap = REQUEST_TIMEOUT_MS * 0.75;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => Promise.resolve(new Response(tricklingBody(gap, 3, init?.signal)))),
    );
    const pending = boundedFetch("https://example.test");
    await vi.advanceTimersByTimeAsync(gap * 4);
    const res = await pending;
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2]));
  });

  it("rejects a stalled body even when the transport ignores the abort", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(tricklingBody(REQUEST_TIMEOUT_MS * 2, 3)))),
    );
    const pending = expect(boundedFetch("https://example.test")).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
  });

  it("gives an upload a longer deadline for its headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            setTimeout(() => resolve(new Response("ok")), REQUEST_TIMEOUT_MS * 2);
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const pending = boundedFetch(
      "https://example.test",
      { method: "POST" },
      { headersTimeoutMs: REQUEST_TIMEOUT_MS * 3 },
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);
    await expect((await pending).text()).resolves.toBe("ok");
  });
});

describe("boundedNativeFetch", () => {
  it("goes through the native client with the same deadline", async () => {
    vi.mocked(tauriFetch).mockImplementation((_url, init) => abortableNever("", init));
    const pending = expect(
      boundedNativeFetch("https://example.test", { headers: { "User-Agent": "Canon" } }),
    ).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
    expect(tauriFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tauriFetch).mock.calls[0]?.[1]?.headers).toEqual({ "User-Agent": "Canon" });
  });

  it("keeps an API key in the failed request's URL out of the error it rejects with", async () => {
    // The native client rejects with reqwest's text, which quotes the whole URL.
    vi.mocked(tauriFetch).mockRejectedValue(
      "error sending request for url (https://webservice.fanart.tv/v3/music/albums/rg?api_key=s3cret)",
    );
    const failure = await boundedNativeFetch("https://webservice.fanart.tv/v3/music/albums/rg?api_key=s3cret").catch(
      (err: unknown) => err,
    );
    expect(String(failure)).toBe(
      "error sending request for url (https://webservice.fanart.tv/v3/music/albums/rg?api_key=[redacted])",
    );
  });

  it("keeps the error's type when it hides a key, so callers can still tell a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed: https://ws.example/?api_key=s3cret")));
    const failure = await boundedFetch("https://ws.example/?api_key=s3cret").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as TypeError).message).toBe("Load failed: https://ws.example/?api_key=[redacted]");
  });
});
