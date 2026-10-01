import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchWikidataImageByMbid } from "./musicbrainz";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchWikidataImageByMbid", () => {
  it("returns the image when Wikidata has one", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { results: { bindings: [{ image: { value: "https://img/x.jpg" } }] } })
    );

    await expect(fetchWikidataImageByMbid("mbid-1")).resolves.toBe("https://img/x.jpg");
  });

  it("returns null when Wikidata answers with no image", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { results: { bindings: [] } }));

    await expect(fetchWikidataImageByMbid("mbid-1")).resolves.toBeNull();
  });

  it("rejects when Wikidata answers with an error status", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchWikidataImageByMbid("mbid-1")).rejects.toThrow("503");
  });

  it("rejects when the request fails", async () => {
    vi.mocked(tauriFetch).mockRejectedValue(new TypeError("Load failed"));

    await expect(fetchWikidataImageByMbid("mbid-1")).rejects.toThrow("Load failed");
  });
});
