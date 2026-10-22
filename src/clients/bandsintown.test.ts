import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./boundedFetch", () => ({ boundedFetch: vi.fn() }));

import { fetchBandsintownEvents } from "./bandsintown";
import { boundedFetch } from "./boundedFetch";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const EVENT = { datetime: "2026-11-01T20:00:00", url: "https://x", venue: { name: "Hall" }, lineup: ["A"] };

afterEach(() => {
  vi.mocked(boundedFetch).mockReset();
});

describe("fetchBandsintownEvents", () => {
  it("caches an answer that has no events", async () => {
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(200, []));
    await expect(fetchBandsintownEvents("Artist A")).resolves.toEqual([]);
    await expect(fetchBandsintownEvents("Artist A")).resolves.toEqual([]);
    expect(boundedFetch).toHaveBeenCalledTimes(1);
  });

  it("caches an artist Bandsintown doesn't know", async () => {
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(404, {}));
    await expect(fetchBandsintownEvents("Artist D")).resolves.toEqual([]);
    await expect(fetchBandsintownEvents("Artist D")).resolves.toEqual([]);
    expect(boundedFetch).toHaveBeenCalledTimes(1);
  });

  it("asks again after a request that timed out", async () => {
    vi.mocked(boundedFetch).mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(fetchBandsintownEvents("Artist B")).rejects.toThrow("aborted");
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(200, [EVENT]));
    const events = await fetchBandsintownEvents("Artist B");
    expect(events.map((event) => event.venueName)).toEqual(["Hall"]);
  });

  it("asks again after a server error", async () => {
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(503, {}));
    await expect(fetchBandsintownEvents("Artist C")).rejects.toThrow();
    await expect(fetchBandsintownEvents("Artist C")).rejects.toThrow();
    expect(boundedFetch).toHaveBeenCalledTimes(2);
  });

  it("drops an event link that isn't a web address", async () => {
    vi.mocked(boundedFetch).mockImplementation(async () =>
      jsonResponse(200, [
        { ...EVENT, url: "file:///etc/passwd" },
        { ...EVENT, url: "https://www.bandsintown.com/e/1" },
      ]),
    );
    const events = await fetchBandsintownEvents("Artist E");
    expect(events.map((event) => event.url)).toEqual(["", "https://www.bandsintown.com/e/1"]);
  });
});
