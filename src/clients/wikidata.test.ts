import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchWikidataClaims } from "./wikidata";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchWikidataClaims", () => {
  it("reads the item's statements", async () => {
    const claims = {
      P571: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { time: "+1985" } } } }],
    };
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { entities: { Q44190: { claims } } }));

    await expect(fetchWikidataClaims("Q44190")).resolves.toEqual(claims);
    const url = new URL(String(vi.mocked(tauriFetch).mock.calls[0]?.[0]));
    expect(url.searchParams.get("ids")).toBe("Q44190");
    expect(url.searchParams.get("props")).toBe("claims");
  });

  it("finds none for an item Wikidata doesn't have", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { error: { code: "no-such-entity", info: "Could not find an entity" } }),
    );

    await expect(fetchWikidataClaims("Q999999999")).resolves.toBeNull();
  });

  it("rejects on any other error, even one riding a 200", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { error: { code: "maxlag", info: "lag" } }));

    await expect(fetchWikidataClaims("Q44190")).rejects.toThrow("maxlag");
  });

  it("rejects when Wikidata didn't answer", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchWikidataClaims("Q44190")).rejects.toThrow("503");
  });

  it("asks nothing for something that isn't an item id", async () => {
    await expect(fetchWikidataClaims("Q1&ids=Q2")).resolves.toBeNull();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});
