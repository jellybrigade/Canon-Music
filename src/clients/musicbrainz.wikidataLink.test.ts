import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../lib/rateLimiter", () => ({ makeRateLimiter: () => async () => {} }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchReleaseGroupWikidataId } from "./musicbrainz";

const RELEASE_GROUP = "46482030-ef12-319c-9c5a-5d04c39d574b";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchReleaseGroupWikidataId", () => {
  it("reads the Wikidata item from the release group's links", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        relations: [
          { type: "allmusic", url: { resource: "https://www.allmusic.com/album/mw0000622910" } },
          { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q1582736" } },
        ],
      }),
    );

    await expect(fetchReleaseGroupWikidataId(RELEASE_GROUP)).resolves.toBe("Q1582736");
    const url = String(vi.mocked(tauriFetch).mock.calls[0]?.[0]);
    expect(url).toContain(`release-group/${RELEASE_GROUP}`);
    expect(url).toContain("inc=url-rels");
  });

  it("finds none without a Wikidata link", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { relations: [{ type: "discogs", url: { resource: "https://www.discogs.com/master/9478" } }] }),
    );

    await expect(fetchReleaseGroupWikidataId(RELEASE_GROUP)).resolves.toBeNull();
  });

  it("rejects when MusicBrainz didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchReleaseGroupWikidataId(RELEASE_GROUP)).rejects.toThrow("503");
  });

  it("asks nothing for something that isn't a MusicBrainz id", async () => {
    await expect(fetchReleaseGroupWikidataId("../artist/x")).resolves.toBeNull();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});
