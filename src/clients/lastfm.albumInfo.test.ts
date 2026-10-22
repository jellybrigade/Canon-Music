import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/keychain", () => ({ keychain: { get: vi.fn() } }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({ select: async () => [], execute: async () => undefined })),
}));

import { keychain } from "../lib/keychain";
import { fetchAlbumInfo } from "./lastfm";

function answerWith(response: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(keychain.get).mockResolvedValue("key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = Promise.allSettled([promise]);
  await vi.runAllTimersAsync();
  const [result] = await settled;
  if (!result) throw new Error("no result");
  return result;
}

describe("fetchAlbumInfo", () => {
  it("rejects when Last.fm answers with a server error, so the stored bio is kept", async () => {
    answerWith(() => new Response("", { status: 503 }));
    const result = await settle(fetchAlbumInfo("slowdive", "Souvlaki"));
    expect(result.status).toBe("rejected");
  });

  it("rejects when Last.fm can't be reached", async () => {
    answerWith(() => Promise.reject(new TypeError("Load failed")));
    const result = await settle(fetchAlbumInfo("slowdive", "Souvlaki"));
    expect(result.status).toBe("rejected");
  });

  it("rejects on a Last.fm error other than an unknown album", async () => {
    answerWith(() => new Response(JSON.stringify({ error: 29, message: "Rate limit exceeded" }), { status: 200 }));
    const result = await settle(fetchAlbumInfo("slowdive", "Souvlaki"));
    expect(result.status).toBe("rejected");
  });

  it("answers no bio when Last.fm doesn't know the album", async () => {
    answerWith(() => new Response(JSON.stringify({ error: 6, message: "Album not found" }), { status: 200 }));
    const result = await settle(fetchAlbumInfo("slowdive", "Unknown"));
    expect(result).toEqual({ status: "fulfilled", value: { bio: null, url: null } });
  });

  it("answers the album's wiki when Last.fm has one", async () => {
    answerWith(
      () =>
        new Response(JSON.stringify({ album: { wiki: { content: "Second album." }, url: "https://last.fm/x" } }), {
          status: 200,
        }),
    );
    const result = await settle(fetchAlbumInfo("slowdive", "Souvlaki"));
    expect(result).toEqual({ status: "fulfilled", value: { bio: "Second album.", url: "https://last.fm/x" } });
  });
});
