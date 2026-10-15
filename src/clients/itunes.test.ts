import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./boundedFetch", () => ({ boundedFetch: vi.fn() }));

import { boundedFetch } from "./boundedFetch";
import { fetchItunesCoverArt } from "./itunes";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.mocked(boundedFetch).mockReset();
});

describe("fetchItunesCoverArt", () => {
  it("caches an answer that has no cover", async () => {
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(200, { results: [] }));
    await expect(fetchItunesCoverArt("Artist A", "Album")).resolves.toBeNull();
    await expect(fetchItunesCoverArt("Artist A", "Album")).resolves.toBeNull();
    expect(boundedFetch).toHaveBeenCalledTimes(1);
  });

  it("asks again after a request that timed out", async () => {
    vi.mocked(boundedFetch).mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(fetchItunesCoverArt("Artist B", "Album")).rejects.toThrow("aborted");
    vi.mocked(boundedFetch).mockImplementation(async () =>
      jsonResponse(200, { results: [{ artworkUrl100: "https://img/100x100bb.jpg" }] }),
    );
    await expect(fetchItunesCoverArt("Artist B", "Album")).resolves.toBe("https://img/600x600bb.jpg");
  });

  it("asks again after a server error", async () => {
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(503, {}));
    await expect(fetchItunesCoverArt("Artist C", "Album")).rejects.toThrow();
    await expect(fetchItunesCoverArt("Artist C", "Album")).rejects.toThrow();
    expect(boundedFetch).toHaveBeenCalledTimes(2);
  });
});
