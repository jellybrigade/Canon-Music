import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS } from "./boundedFetch";
import { fetchLyrics } from "./lrclib";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchLyrics on a server that never answers", () => {
  it("gives up instead of leaving lyrics loading forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const pending = expect(fetchLyrics({ artist: "a", album: "b", title: "c", durationSec: null })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
  });
});
