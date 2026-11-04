import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./boundedFetch", () => ({ boundedFetch: vi.fn() }));

import { boundedFetch } from "./boundedFetch";
import { fetchItunesArtistAlbums, ITUNES_LIMIT_COOLDOWN_MS, searchItunesArtists } from "./itunesCatalog";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestedUrls(): URL[] {
  return vi.mocked(boundedFetch).mock.calls.map(([url]) => new URL(String(url)));
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(boundedFetch).mockReset();
});

describe("searchItunesArtists", () => {
  it("asks for artists by name and reads each one", async () => {
    vi.useFakeTimers();
    vi.mocked(boundedFetch).mockImplementation(async () =>
      jsonResponse(200, {
        resultCount: 3,
        results: [
          { wrapperType: "artist", artistId: 6796357519, artistName: "PISS" },
          { wrapperType: "artist", artistId: 1565732890, artistName: "P.I.S.S." },
          { wrapperType: "artist", artistId: "broken" },
        ],
      }),
    );

    await expect(searchItunesArtists("PISS")).resolves.toEqual([
      { id: 6796357519, name: "PISS" },
      { id: 1565732890, name: "P.I.S.S." },
    ]);
    const [url] = requestedUrls();
    expect(url?.searchParams.get("term")).toBe("PISS");
    expect(url?.searchParams.get("entity")).toBe("musicArtist");
  });
});

describe("fetchItunesArtistAlbums", () => {
  it("lists the artist's releases", async () => {
    vi.useFakeTimers();
    vi.mocked(boundedFetch).mockImplementation(async () =>
      jsonResponse(200, {
        results: [
          { wrapperType: "artist", artistId: 6796357519, artistName: "PISS" },
          {
            wrapperType: "collection",
            artistName: "PISS",
            collectionName: "time loop at hot slit - Single",
            trackCount: 1,
            releaseDate: "2026-09-02T07:00:00Z",
          },
        ],
      }),
    );

    const albums = fetchItunesArtistAlbums(6796357519);
    await vi.runAllTimersAsync();
    await expect(albums).resolves.toEqual([
      {
        title: "time loop at hot slit",
        recordType: "single",
        trackCount: 1,
        artistName: "PISS",
        releaseDate: "2026-09-02",
      },
    ]);
    const [url] = requestedUrls();
    expect(url?.searchParams.get("id")).toBe("6796357519");
    expect(url?.searchParams.get("entity")).toBe("album");
  });

  it("rejects when iTunes didn't answer, so the lookup is retried", async () => {
    vi.useFakeTimers();
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(502, {}));

    const albums = fetchItunesArtistAlbums(1).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(String(await albums)).toContain("502");
  });

  it("rejects on iTunes' 403 rate limit, then holds off the host", async () => {
    vi.useFakeTimers();
    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(403, {}));
    const first = fetchItunesArtistAlbums(1).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(String(await first)).toContain("403");
    const callsAfterLimit = vi.mocked(boundedFetch).mock.calls.length;

    vi.mocked(boundedFetch).mockImplementation(async () => jsonResponse(200, { results: [] }));
    const next = fetchItunesArtistAlbums(2);
    await vi.advanceTimersByTimeAsync(ITUNES_LIMIT_COOLDOWN_MS - 1000);
    expect(boundedFetch).toHaveBeenCalledTimes(callsAfterLimit);
    await vi.advanceTimersByTimeAsync(ITUNES_LIMIT_COOLDOWN_MS);
    await expect(next).resolves.toEqual([]);
    expect(boundedFetch).toHaveBeenCalledTimes(callsAfterLimit + 1);
  });
});
