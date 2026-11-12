import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  fetchWikipediaSummaryText,
  fetchWikipediaTitleByArtist,
  fetchWikipediaTitleByReleaseGroup,
  fetchWikipediaTitleByWikidataId,
} from "./wikipedia";

const RELEASE_GROUP = "5413753c-9404-4cb7-af0c-f3957a91487d";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestedUrl(call = 0): string {
  return String(vi.mocked(tauriFetch).mock.calls[call]?.[0]);
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchWikipediaTitleByReleaseGroup", () => {
  it("reads the English article of the Wikidata item carrying the release group id", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        results: { bindings: [{ article: { value: "https://en.wikipedia.org/wiki/Preacher%27s_Daughter" } }] },
      }),
    );

    await expect(fetchWikipediaTitleByReleaseGroup(RELEASE_GROUP)).resolves.toBe("Preacher's_Daughter");
    const body = String(vi.mocked(tauriFetch).mock.calls[0]?.[1]?.body);
    expect(new URLSearchParams(body).get("query")).toContain(`P436 "${RELEASE_GROUP}"`);
  });

  it("finds none when no item carries the id", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { results: { bindings: [] } }));

    await expect(fetchWikipediaTitleByReleaseGroup(RELEASE_GROUP)).resolves.toBeNull();
  });

  it("rejects when Wikidata didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(429, {}));

    await expect(fetchWikipediaTitleByReleaseGroup(RELEASE_GROUP)).rejects.toThrow("429");
  });

  it("never writes something other than a MusicBrainz id into the query", async () => {
    await expect(fetchWikipediaTitleByReleaseGroup('x" . ?a ?b ?c')).resolves.toBeNull();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});

describe("fetchWikipediaTitleByArtist", () => {
  const ARTIST = "8f2b8b2a-3b4c-4d5e-9f60-1a2b3c4d5e6f";

  it("reads the English article of the Wikidata item carrying the artist id", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { results: { bindings: [{ article: { value: "https://en.wikipedia.org/wiki/Slowdive" } }] } }),
    );

    await expect(fetchWikipediaTitleByArtist(ARTIST)).resolves.toBe("Slowdive");
    const body = String(vi.mocked(tauriFetch).mock.calls[0]?.[1]?.body);
    expect(new URLSearchParams(body).get("query")).toContain(`P434 "${ARTIST}"`);
  });

  it("finds none when no item carries the id", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { results: { bindings: [] } }));

    await expect(fetchWikipediaTitleByArtist(ARTIST)).resolves.toBeNull();
  });

  it("rejects when Wikidata didn't answer, so a stored biography isn't erased", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchWikipediaTitleByArtist(ARTIST)).rejects.toThrow("503");
  });

  it("never writes something other than a MusicBrainz id into the query", async () => {
    await expect(fetchWikipediaTitleByArtist('x" . } DELETE {')).resolves.toBeNull();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});

describe("fetchWikipediaTitleByWikidataId", () => {
  it("reads the English sitelink", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        entities: { Q112980488: { sitelinks: { enwiki: { site: "enwiki", title: "Preacher's Daughter" } } } },
      }),
    );

    await expect(fetchWikipediaTitleByWikidataId("Q112980488")).resolves.toBe("Preacher's Daughter");
    expect(requestedUrl()).toContain("ids=Q112980488");
  });

  it("finds none for an item without an English article", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { entities: { Q1: { sitelinks: {} } } }));

    await expect(fetchWikipediaTitleByWikidataId("Q1")).resolves.toBeNull();
  });

  it("finds none for an item Wikidata doesn't have", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { error: { code: "no-such-entity", info: "Could not find an entity" } }),
    );

    await expect(fetchWikipediaTitleByWikidataId("Q999999999999")).resolves.toBeNull();
  });

  it("rejects on any other error, even inside a 200", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { error: { code: "maxlag", info: "Waiting for a database server" } }),
    );

    await expect(fetchWikipediaTitleByWikidataId("Q1")).rejects.toThrow("maxlag");
  });

  it("skips anything that isn't an item id", async () => {
    await expect(fetchWikipediaTitleByWikidataId("Q1|Q2")).resolves.toBeNull();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});

describe("fetchWikipediaSummaryText", () => {
  it("returns the article's lead", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { type: "standard", extract: "  Souvlaki is the second studio album.  " }),
    );

    await expect(fetchWikipediaSummaryText("Souvlaki (album)")).resolves.toBe("Souvlaki is the second studio album.");
    expect(requestedUrl()).toContain("/page/summary/Souvlaki%20(album)");
  });

  it("doesn't take a disambiguation page as a description", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { type: "disambiguation", extract: "Souvlaki may refer to:" }),
    );

    await expect(fetchWikipediaSummaryText("Souvlaki")).resolves.toBeNull();
  });

  it("finds none for a missing article", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(404, {}));

    await expect(fetchWikipediaSummaryText("Gone")).resolves.toBeNull();
  });

  it("rejects when Wikipedia didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchWikipediaSummaryText("Souvlaki (album)")).rejects.toThrow("503");
  });
});
