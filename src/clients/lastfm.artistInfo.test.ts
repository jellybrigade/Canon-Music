import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/keychain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/keychain")>()),
  keychain: { get: vi.fn() },
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({ select: async () => [], execute: async () => undefined })),
}));

import { keychain, SECRET_STORE_UNAVAILABLE } from "../lib/keychain";
import { fetchAlbumTags, fetchArtistInfo, fetchArtistTopAlbums, fetchArtistTopTracks } from "./lastfm";

function lastfmResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(keychain.get).mockResolvedValue("key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("artist.getSimilar")
        ? lastfmResponse({ similarartists: { artist: [{ name: "B", match: "0.9" }] } })
        : lastfmResponse({ artist: { similar: { artist: [] } } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("fetchArtistInfo", () => {
  it("reads the API key once for both the info and the similar-artists request", async () => {
    const info = fetchArtistInfo("A");
    await vi.runAllTimersAsync();

    await expect(info).resolves.toMatchObject({ similar: ["B"] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keychain.get).toHaveBeenCalledTimes(1);
  });
});

describe("Last.fm reads that get no answer", () => {
  function answerEvery(response: () => Response) {
    vi.mocked(fetch).mockImplementation(async () => response());
  }

  async function settled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
    const outcome = Promise.allSettled([promise]);
    await vi.runAllTimersAsync();
    const [result] = await outcome;
    if (!result) throw new Error("allSettled returned nothing");
    return result;
  }

  it.each([
    ["artist info", (): Promise<unknown> => fetchArtistInfo("A")],
    ["top albums", () => fetchArtistTopAlbums("A")],
    ["top tracks", () => fetchArtistTopTracks("A")],
  ])("rejects %s on a server error instead of answering empty", async (_label, read) => {
    answerEvery(() => new Response("", { status: 503 }));
    expect((await settled(read())).status).toBe("rejected");
  });

  it.each([
    ["artist info", (): Promise<unknown> => fetchArtistInfo("A")],
    ["top albums", () => fetchArtistTopAlbums("A")],
    ["top tracks", () => fetchArtistTopTracks("A")],
  ])("rejects %s on a rate-limit error in the body", async (_label, read) => {
    answerEvery(() => lastfmResponse({ error: 29, message: "Rate limit exceeded" }));
    expect((await settled(read())).status).toBe("rejected");
  });

  it("answers an artist Last.fm doesn't know with empty info", async () => {
    answerEvery(() => lastfmResponse({ error: 6, message: "The artist you supplied could not be found" }));
    const result = await settled(fetchArtistInfo("A"));
    expect(result).toMatchObject({ status: "fulfilled", value: { bio: null, listeners: null, similar: [] } });
  });

  it("answers an album Last.fm doesn't know with no tags", async () => {
    answerEvery(() => lastfmResponse({ error: 6, message: "Album not found" }));
    const result = await settled(fetchAlbumTags("A", "B"));
    expect(result).toEqual({ status: "fulfilled", value: { genres: [], moods: [] } });
  });

  it("answers no tags without a key instead of failing every album", async () => {
    vi.mocked(keychain.get).mockRejectedValue("No matching entry found in secure storage");
    const result = await settled(fetchAlbumTags("A", "B"));
    expect(result).toEqual({ status: "fulfilled", value: { genres: [], moods: [] } });
  });

  it("rejects when the secret store is locked rather than reading it as no key", async () => {
    vi.mocked(keychain.get).mockRejectedValue(`${SECRET_STORE_UNAVAILABLE}collection is locked`);
    expect((await settled(fetchArtistInfo("A"))).status).toBe("rejected");
    expect((await settled(fetchAlbumTags("A", "B"))).status).toBe("rejected");
    expect(fetch).not.toHaveBeenCalled();
  });
});
