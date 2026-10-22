import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchTheAudioDbArtist, fetchWikipediaBio, fetchWikipediaBioByMbid } from "./theaudiodb";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("fetchTheAudioDbArtist", () => {
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

describe("fetchWikipediaBio", () => {
  it("doesn't take a disambiguation page as a biography", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { type: "disambiguation", extract: "Can may refer to:" }),
    );

    await expect(fetchWikipediaBio("Can")).resolves.toBeNull();
  });
});

describe("fetchWikipediaBioByMbid", () => {
  it("never sends an id that isn't a MusicBrainz id into the query", async () => {
    await expect(fetchWikipediaBioByMbid('x" . } DELETE {')).resolves.toBeNull();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});
