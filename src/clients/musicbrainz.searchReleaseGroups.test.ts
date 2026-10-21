import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../lib/rateLimiter", () => ({ makeRateLimiter: () => async () => {} }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { searchReleaseGroups } from "./musicbrainz";

function respondWith(releaseGroup: Record<string, unknown>) {
  vi.mocked(tauriFetch).mockImplementation(
    async () =>
      new Response(JSON.stringify({ "release-groups": [{ id: "rg-1", title: "Sun", score: 100, ...releaseGroup }] }), {
        status: 200,
      }),
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("searchReleaseGroups", () => {
  it("names every credited artist, not only the first", async () => {
    respondWith({
      "artist-credit": [
        { name: "Ski Aggu", joinphrase: " & ", artist: { id: "mbid-ski", name: "Ski Aggu" } },
        { name: "Filow", artist: { id: "mbid-filow", name: "Filow" } },
      ],
    });

    const [hit] = await searchReleaseGroups("Filow", "Sun");

    expect(hit?.artistName).toBe("Ski Aggu & Filow");
    expect(hit?.artistMbid).toBe("mbid-ski");
  });

  it("leaves the artist blank when MusicBrainz credits nobody, instead of echoing the search", async () => {
    respondWith({});

    const [hit] = await searchReleaseGroups("Filow", "Sun");

    expect(hit?.artistName).toBe("");
  });

  it("keeps the secondary types", async () => {
    respondWith({ "primary-type": "Album", "secondary-types": ["Live", "Compilation"] });

    const [hit] = await searchReleaseGroups("Filow", "Sun");

    expect(hit?.secondaryTypes).toEqual(["Live", "Compilation"]);
  });
});
