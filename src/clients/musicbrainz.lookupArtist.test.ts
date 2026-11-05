import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../lib/rateLimiter", () => ({ makeRateLimiter: () => async () => {} }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { lookupArtist } from "./musicbrainz";

const RADIOHEAD = "a74b1b7f-71a5-4011-9441-d0b5e4122711";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("lookupArtist", () => {
  it("reads the type, the start of the life span and the Wikidata item", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        id: RADIOHEAD,
        name: "Radiohead",
        type: "Group",
        country: "GB",
        "life-span": { begin: "1991", ended: false },
        relations: [
          { type: "discogs", url: { resource: "https://www.discogs.com/artist/3840" } },
          { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q44190" } },
        ],
      }),
    );

    const artist = await lookupArtist(RADIOHEAD);

    expect(artist).toMatchObject({ type: "Group", country: "GB", lifeSpanBegin: "1991", wikidataId: "Q44190" });
    const url = String(vi.mocked(tauriFetch).mock.calls[0]?.[0]);
    expect(new URL(url).searchParams.get("inc")).toBe("genres+url-rels");
  });

  it("reads absent fields as none", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { id: RADIOHEAD, name: "Radiohead" }));

    await expect(lookupArtist(RADIOHEAD)).resolves.toMatchObject({
      type: null,
      country: null,
      lifeSpanBegin: null,
      wikidataId: null,
    });
  });

  it("rejects when MusicBrainz didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(lookupArtist(RADIOHEAD)).rejects.toThrow("503");
  });
});
