import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../lib/rateLimiter", () => ({ makeRateLimiter: () => async () => {} }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchReleaseGroupDiscogsMasterId } from "./musicbrainz";

const RELEASE_GROUP = "b1392450-e666-3926-a536-22c65f834433";

function answer(status: number, body: unknown): void {
  vi.mocked(tauriFetch).mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchReleaseGroupDiscogsMasterId", () => {
  it("reads the Discogs master from the release group's links", async () => {
    answer(200, {
      relations: [
        { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q202996" } },
        { type: "discogs", url: { resource: "https://www.discogs.com/master/21491" } },
      ],
    });

    await expect(fetchReleaseGroupDiscogsMasterId(RELEASE_GROUP)).resolves.toBe(21491);
    expect(String(vi.mocked(tauriFetch).mock.calls[0]?.[0])).toContain("inc=url-rels");
  });

  it("ignores a Discogs link that isn't a master", async () => {
    answer(200, { relations: [{ type: "discogs", url: { resource: "https://www.discogs.com/release/4950798" } }] });
    await expect(fetchReleaseGroupDiscogsMasterId(RELEASE_GROUP)).resolves.toBeNull();
  });

  it("rejects when MusicBrainz didn't answer", async () => {
    answer(503, {});
    await expect(fetchReleaseGroupDiscogsMasterId(RELEASE_GROUP)).rejects.toThrow("503");
  });
});
