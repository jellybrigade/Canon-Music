import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLyricsOvh } from "./lyricsOvh";
import { REQUEST_TIMEOUT_MS } from "./boundedFetch";

function respondWith(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLyricsOvh", () => {
  it("answers null when lyrics.ovh has no lyrics for the track", async () => {
    respondWith(404, { error: "No lyrics found" });
    await expect(fetchLyricsOvh("a", "b")).resolves.toBeNull();
  });

  it("throws when lyrics.ovh fails, so the miss is not cached as final", async () => {
    respondWith(503, {});
    await expect(fetchLyricsOvh("a", "b")).rejects.toThrow("503");
  });
});

describe("fetchLyricsOvh on a server that never answers", () => {
  it("gives up instead of leaving lyrics loading forever", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })));
      const pending = expect(fetchLyricsOvh("a", "b")).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
