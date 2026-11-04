import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  DISCOGS_QUOTA_COOLDOWN_MS,
  DISCOGS_REQUEST_INTERVAL_MS,
  fetchDiscogsMainReleaseId,
  fetchDiscogsRelease,
  searchDiscogsReleases,
} from "./discogs";

function answer(status: number, body: unknown): void {
  vi.mocked(tauriFetch).mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}

// Every request waits its turn on the host budget, so each call needs the clock moved past it.
async function settle<T>(request: Promise<T>): Promise<T> {
  request.catch(() => {});
  await vi.advanceTimersByTimeAsync(DISCOGS_REQUEST_INTERVAL_MS);
  return request;
}

function requestOf(index: number): { url: URL; headers: Headers } {
  const [url, init] = vi.mocked(tauriFetch).mock.calls[index] ?? [];
  return { url: new URL(String(url)), headers: new Headers(init?.headers) };
}

// The host budget outlives each test, so every test starts an hour after the last one's clock.
let clock = Date.UTC(2026, 10, 5);

beforeEach(() => {
  vi.useFakeTimers();
  clock += 60 * 60 * 1000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(tauriFetch).mockReset();
});

describe("searchDiscogsReleases", () => {
  it("searches releases by artist and title, with a User-Agent, and splits each hit's title", async () => {
    answer(200, {
      results: [
        { id: 38888610, master_id: 4391529, title: "PISS (16) - you made me / skin on linen", year: "2026" },
        { id: 13878707, master_id: 0, title: "Weatherday - Come In", year: "" },
        { id: "broken" },
        { id: 5, master_id: 0, title: "no separator" },
      ],
    });

    await expect(settle(searchDiscogsReleases("PISS", "you made me / skin on linen"))).resolves.toEqual([
      { id: 38888610, masterId: 4391529, artistName: "PISS (16)", title: "you made me / skin on linen", year: 2026 },
      { id: 13878707, masterId: null, artistName: "Weatherday", title: "Come In", year: null },
    ]);
    const { url, headers } = requestOf(0);
    expect(url.pathname).toBe("/database/search");
    expect(url.searchParams.get("artist")).toBe("PISS");
    expect(url.searchParams.get("release_title")).toBe("you made me / skin on linen");
    expect(url.searchParams.get("type")).toBe("release");
    expect(headers.get("User-Agent")).toMatch(/^Canon/);
  });

  it("rejects when the search asks for a token, so a locked search never reads as no match", async () => {
    answer(401, { message: "You must authenticate to access this resource." });
    await expect(settle(searchDiscogsReleases("PISS", "x"))).rejects.toThrow("401");
  });

  it("rejects on a server error", async () => {
    answer(502, {});
    await expect(settle(searchDiscogsReleases("PISS", "x"))).rejects.toThrow("502");
  });

  it("holds off the host after a 429", async () => {
    answer(429, { message: "You are making requests too quickly." });
    await expect(settle(searchDiscogsReleases("PISS", "x"))).rejects.toThrow("429");

    answer(200, { results: [] });
    const next = searchDiscogsReleases("PISS", "y");
    next.catch(() => {});
    await vi.advanceTimersByTimeAsync(DISCOGS_QUOTA_COOLDOWN_MS - DISCOGS_REQUEST_INTERVAL_MS - 1000);
    expect(tauriFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DISCOGS_REQUEST_INTERVAL_MS + 1000);
    await expect(next).resolves.toEqual([]);
    expect(tauriFetch).toHaveBeenCalledTimes(2);
  });
});

describe("fetchDiscogsMainReleaseId", () => {
  it("reads the master's main release", async () => {
    answer(200, { id: 21491, main_release: 4950798 });
    await expect(settle(fetchDiscogsMainReleaseId(21491))).resolves.toBe(4950798);
    expect(requestOf(0).url.pathname).toBe("/masters/21491");
  });

  it("is null for a master Discogs doesn't have", async () => {
    answer(404, { message: "Master Release not found." });
    await expect(settle(fetchDiscogsMainReleaseId(1))).resolves.toBeNull();
  });
});

describe("fetchDiscogsRelease", () => {
  it("reads labels, country, styles, kind and counts tracks without headings", async () => {
    answer(200, {
      id: 13878707,
      title: "Come In",
      artists: [{ name: "Weatherday" }],
      labels: [{ name: "Not On Label (Weatherday Self-released)", catno: "none" }],
      country: "Sweden",
      genres: ["Rock"],
      styles: ["Lo-Fi", "Emo"],
      formats: [{ name: "File", descriptions: ["MP3", "Album"] }],
      tracklist: [
        { type_: "heading", title: "Side A" },
        { type_: "track", title: "1" },
        { type_: "index", title: "Suite", sub_tracks: [{ type_: "track" }, { type_: "track" }] },
      ],
    });

    await expect(settle(fetchDiscogsRelease(13878707))).resolves.toEqual({
      id: 13878707,
      title: "Come In",
      artistNames: ["Weatherday"],
      labels: [{ name: "Not On Label (Weatherday Self-released)", catalogNumber: "none" }],
      country: "Sweden",
      genres: ["Rock"],
      styles: ["Lo-Fi", "Emo"],
      formatDescriptions: ["MP3", "Album"],
      trackCount: 3,
    });
    expect(requestOf(0).url.pathname).toBe("/releases/13878707");
  });

  it("is null for a release Discogs deleted", async () => {
    answer(404, { message: "That release does not exist or may have been deleted." });
    await expect(settle(fetchDiscogsRelease(1))).resolves.toBeNull();
  });

  it("rejects an answer without a title", async () => {
    answer(200, { id: 1 });
    await expect(settle(fetchDiscogsRelease(1))).rejects.toThrow();
  });
});
