import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  fetchListenBrainzArtistPopularity,
  fetchListenBrainzReleaseGroupListens,
  fetchListenBrainzSimilarArtists,
} from "./listenbrainz";

const RADIOHEAD = "a74b1b7f-71a5-4011-9441-d0b5e4122711";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function requests(): { url: URL; init: RequestInit | undefined }[] {
  return vi.mocked(tauriFetch).mock.calls.map(([url, init]) => ({ url: new URL(String(url)), init }));
}

// Each test starts its fake clock past every earlier test's spacing and hold-off.
let clock = Date.UTC(2026, 10, 4);
beforeEach(() => {
  vi.useFakeTimers();
  clock += 3_600_000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchListenBrainzSimilarArtists", () => {
  it("reads ranked artists with their score, best first", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, [
        { artist_mbid: "9c9f1380-2516-4fc9-a3e6-f9f61941d090", name: "Muse", score: 10286, type: "Group" },
        { artist_mbid: "5b11f4ce-a62d-471e-81fc-a69a8278c7da", name: "Nirvana", score: 11156, type: "Group" },
        { artist_mbid: 7, name: "Broken" },
      ]),
    );

    await expect(fetchListenBrainzSimilarArtists(RADIOHEAD)).resolves.toEqual([
      { mbid: "5b11f4ce-a62d-471e-81fc-a69a8278c7da", name: "Nirvana", score: 11156 },
      { mbid: "9c9f1380-2516-4fc9-a3e6-f9f61941d090", name: "Muse", score: 10286 },
    ]);
    const [request] = requests();
    expect(request?.url.host).toBe("labs.api.listenbrainz.org");
    expect(request?.url.searchParams.get("artist_mbids")).toBe(RADIOHEAD);
    expect(request?.url.searchParams.get("algorithm")).toMatch(/^session_based_/);
  });

  it("answers an empty list for an artist ListenBrainz doesn't know", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, []));

    await expect(fetchListenBrainzSimilarArtists(UNKNOWN)).resolves.toEqual([]);
  });

  it("rejects when the algorithm is no longer offered, so it never reads as no similar artists", async () => {
    vi.mocked(tauriFetch).mockImplementation(
      async () => new Response("<!doctype html><title>400 Bad Request</title>", { status: 400 }),
    );

    await expect(fetchListenBrainzSimilarArtists(RADIOHEAD)).rejects.toThrow("400");
  });

  it("rejects an answer that isn't a list", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { error: "nope" }));

    await expect(fetchListenBrainzSimilarArtists(RADIOHEAD)).rejects.toThrow();
  });

  it("asks nothing for an id that isn't an MBID", async () => {
    await expect(fetchListenBrainzSimilarArtists("radiohead")).resolves.toEqual([]);
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});

describe("fetchListenBrainzArtistPopularity", () => {
  it("posts the ids and reads counts, null for an artist with none", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, [
        { artist_mbid: RADIOHEAD, total_listen_count: 134659628, total_user_count: 461120 },
        { artist_mbid: UNKNOWN, total_listen_count: null, total_user_count: null },
      ]),
    );

    await expect(fetchListenBrainzArtistPopularity([RADIOHEAD, UNKNOWN])).resolves.toEqual([
      { mbid: RADIOHEAD, listenCount: 134659628, userCount: 461120 },
      { mbid: UNKNOWN, listenCount: null, userCount: null },
    ]);
    const [request] = requests();
    expect(request?.url.toString()).toBe("https://api.listenbrainz.org/1/popularity/artist");
    expect(request?.init?.method).toBe("POST");
    expect(JSON.parse(String(request?.init?.body))).toEqual({ artist_mbids: [RADIOHEAD, UNKNOWN] });
  });

  it("asks nothing for no ids", async () => {
    await expect(fetchListenBrainzArtistPopularity([])).resolves.toEqual([]);
    expect(tauriFetch).not.toHaveBeenCalled();
  });

  it("rejects when ListenBrainz didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchListenBrainzArtistPopularity([RADIOHEAD])).rejects.toThrow("503");
  });
});

const OK_COMPUTER = "b1392450-e666-3926-a536-22c65f834433";

describe("fetchListenBrainzReleaseGroupListens", () => {
  it("posts the ids and reads listen counts, null for a release group with none", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, [
        { release_group_mbid: OK_COMPUTER, total_listen_count: 1781830, total_user_count: 25280 },
        { release_group_mbid: UNKNOWN, total_listen_count: null, total_user_count: null },
      ]),
    );

    await expect(fetchListenBrainzReleaseGroupListens([OK_COMPUTER, UNKNOWN, "not-an-mbid"])).resolves.toEqual([
      { mbid: OK_COMPUTER, listenCount: 1781830 },
      { mbid: UNKNOWN, listenCount: null },
    ]);
    const [request] = requests();
    expect(request?.url.toString()).toBe("https://api.listenbrainz.org/1/popularity/release-group");
    expect(request?.init?.method).toBe("POST");
    expect(JSON.parse(String(request?.init?.body))).toEqual({ release_group_mbids: [OK_COMPUTER, UNKNOWN] });
  });

  it("asks nothing for no ids", async () => {
    await expect(fetchListenBrainzReleaseGroupListens(["not-an-mbid"])).resolves.toEqual([]);
    expect(tauriFetch).not.toHaveBeenCalled();
  });

  it("rejects when ListenBrainz didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchListenBrainzReleaseGroupListens([OK_COMPUTER])).rejects.toThrow("503");
  });
});

describe("ListenBrainz rate limit", () => {
  it("holds off the host for as long as its 429 says", async () => {
    vi.mocked(tauriFetch).mockImplementationOnce(async () =>
      jsonResponse(429, { code: 429, error: "Too many requests" }, { "X-RateLimit-Reset-In": "8" }),
    );
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, []));

    await expect(fetchListenBrainzArtistPopularity([RADIOHEAD])).rejects.toThrow("429");
    expect(tauriFetch).toHaveBeenCalledTimes(1);

    const next = fetchListenBrainzArtistPopularity([RADIOHEAD]);
    await vi.advanceTimersByTimeAsync(7000);
    expect(tauriFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await next;
    expect(tauriFetch).toHaveBeenCalledTimes(2);
  });
});
