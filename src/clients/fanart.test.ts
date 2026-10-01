import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../lib/keychain", () => ({ keychain: {} }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchFanartTvImageByMbid } from "./fanart";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchFanartTvImageByMbid", () => {
  it("returns the artist thumb", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { artistthumb: [{ url: "https://img/thumb.jpg" }] })
    );

    await expect(fetchFanartTvImageByMbid("mbid-1", "key")).resolves.toBe("https://img/thumb.jpg");
  });

  it("returns null when fanart.tv has no entry for the artist", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(404, {}));

    await expect(fetchFanartTvImageByMbid("mbid-1", "key")).resolves.toBeNull();
  });

  it.each([401, 403])("returns null when fanart.tv refuses the key with %i", async (status) => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(status, {}));

    await expect(fetchFanartTvImageByMbid("mbid-1", "bad-key")).resolves.toBeNull();
  });

  it("rejects when fanart.tv answers with a server error", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(500, {}));

    await expect(fetchFanartTvImageByMbid("mbid-1", "key")).rejects.toThrow("500");
  });
});
