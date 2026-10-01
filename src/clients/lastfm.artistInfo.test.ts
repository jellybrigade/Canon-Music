import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/keychain", () => ({ keychain: { get: vi.fn() } }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({ select: async () => [], execute: async () => undefined })),
}));

import { keychain } from "../lib/keychain";
import { fetchArtistInfo } from "./lastfm";

function lastfmResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(keychain.get).mockResolvedValue("key");
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.includes("artist.getSimilar")
      ? lastfmResponse({ similarartists: { artist: [{ name: "B", match: "0.9" }] } })
      : lastfmResponse({ artist: { similar: { artist: [] } } })
  ));
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
