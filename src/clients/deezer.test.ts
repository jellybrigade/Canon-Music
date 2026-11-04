import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { fetchDeezerAlbum, fetchDeezerDiscography, searchDeezerAlbums } from "./deezer";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestedUrls(): string[] {
  return vi.mocked(tauriFetch).mock.calls.map(([url]) => String(url));
}

afterEach(() => {
  vi.mocked(tauriFetch).mockReset();
});

describe("searchDeezerAlbums", () => {
  it("asks for the artist and album fields and reads each hit", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          {
            id: 1042239632,
            title: "you made me / skin on linen",
            nb_tracks: 15,
            record_type: "album",
            cover_xl: "https://cdn-images.dzcdn.net/x.jpg",
            artist: { id: 419317862, name: "PISS" },
          },
          { id: "broken" },
        ],
        total: 2,
      }),
    );

    await expect(searchDeezerAlbums('PISS "x"', "you made me / skin on linen")).resolves.toEqual([
      {
        id: 1042239632,
        title: "you made me / skin on linen",
        recordType: "album",
        trackCount: 15,
        artistId: 419317862,
        artistName: "PISS",
      },
    ]);
    const [url] = requestedUrls();
    expect(new URL(url ?? "").searchParams.get("q")).toBe('artist:"PISS x" album:"you made me / skin on linen"');
  });

  it("rejects when Deezer didn't answer, so the lookup is retried", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(502, {}));

    await expect(searchDeezerAlbums("PISS", "x")).rejects.toThrow("502");
  });
});

describe("fetchDeezerAlbum", () => {
  it("reads the edition's date, label and type", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        id: 1042239632,
        title: "you made me / skin on linen",
        record_type: "album",
        nb_tracks: 15,
        release_date: "2026-10-30",
        label: "Sub Pop Records",
        upc: "098787175363",
      }),
    );

    await expect(fetchDeezerAlbum(1042239632)).resolves.toEqual({
      releaseDate: "2026-10-30",
      label: "Sub Pop Records",
      recordType: "album",
    });
  });

  it("answers null for Deezer's 'no data' error", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { error: { type: "DataException", message: "no data", code: 800 } }),
    );

    await expect(fetchDeezerAlbum(1)).resolves.toBeNull();
  });
});

describe("fetchDeezerDiscography", () => {
  it("follows the pages Deezer lists", async () => {
    vi.mocked(tauriFetch).mockImplementation(async (url) =>
      String(url).includes("index=100")
        ? jsonResponse(200, { data: [{ title: "Old", record_type: "album", release_date: "2010-01-01" }] })
        : jsonResponse(200, {
            data: [{ title: "New", record_type: "single", release_date: "2026-09-02" }],
            next: "https://api.deezer.com/artist/5/albums?limit=100&index=100",
          }),
    );

    await expect(fetchDeezerDiscography(5)).resolves.toEqual([
      { title: "New", recordType: "single", releaseDate: "2026-09-02" },
      { title: "Old", recordType: "album", releaseDate: "2010-01-01" },
    ]);
    expect(requestedUrls()).toHaveLength(2);
  });
});
