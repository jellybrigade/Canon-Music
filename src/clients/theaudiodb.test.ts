import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchTheAudioDbArtist } from "./theaudiodb";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchTheAudioDbArtist", () => {
  it("asks with the public key TheAudioDB still serves, since key 2 now answers 404 to everything", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(200, { artists: null }));

    await fetchTheAudioDbArtist("Slowdive");

    expect(vi.mocked(tauriFetch).mock.calls[0]?.[0]).toBe(
      "https://www.theaudiodb.com/api/v1/json/123/search.php?s=Slowdive",
    );
  });

  it("rejects when TheAudioDB didn't answer, so a portrait lookup can be retried", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(503, {}));

    await expect(fetchTheAudioDbArtist("Slowdive")).rejects.toThrow("503");
  });

  it("skips a hit for another artist", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        artists: [
          { strArtist: "Slowdive Tribute Band", strBiographyEN: "Wrong", strArtistThumb: "https://img/wrong.jpg" },
          { strArtist: "Slowdive", strBiographyEN: "Right", strArtistThumb: "https://img/right.jpg" },
        ],
      }),
    );

    await expect(fetchTheAudioDbArtist("slowdive")).resolves.toEqual({
      bio: "Right",
      thumbUrl: "https://img/right.jpg",
    });
  });

  it("finds nothing when no hit is the artist", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { artists: [{ strArtist: "Someone Else", strBiographyEN: "Wrong" }] }),
    );

    await expect(fetchTheAudioDbArtist("Slowdive")).resolves.toEqual({ bio: null, thumbUrl: null });
  });
});
