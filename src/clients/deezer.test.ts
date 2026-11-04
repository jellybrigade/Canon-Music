import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  fetchDeezerAlbum,
  fetchDeezerArtistTopTracks,
  fetchDeezerDiscography,
  fetchDeezerRelatedArtists,
  searchDeezerAlbums,
  searchDeezerArtists,
} from "./deezer";

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
        coverUrl: "https://cdn-images.dzcdn.net/x.jpg",
      },
    ]);
    const [url] = requestedUrls();
    expect(new URL(url ?? "").searchParams.get("q")).toBe('artist:"PISS x" album:"you made me / skin on linen"');
  });

  it("rejects when Deezer didn't answer, so the lookup is retried", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(502, {}));

    await expect(searchDeezerAlbums("PISS", "x")).rejects.toThrow("502");
  });

  it("keeps only a cover served over https", async () => {
    const hit = { id: 1, title: "x", nb_tracks: 1, record_type: "single", artist: { id: 2, name: "PISS" } };
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          { ...hit, cover_xl: "http://cdn/x.jpg" },
          { ...hit, id: 3 },
        ],
      }),
    );

    const hits = await searchDeezerAlbums("PISS", "x");
    expect(hits.map(({ coverUrl }) => coverUrl)).toEqual([null, null]);
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

describe("searchDeezerArtists", () => {
  it("asks for the name and reads each artist", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          { id: 69103042, name: "Weatherday", nb_fan: 5000, picture_xl: "https://cdn-images.dzcdn.net/a.jpg" },
          { id: "broken", name: 4 },
        ],
      }),
    );

    await expect(searchDeezerArtists("Weatherday")).resolves.toEqual([{ id: 69103042, name: "Weatherday" }]);
    const [url] = requestedUrls();
    expect(new URL(url ?? "").pathname).toBe("/search/artist");
    expect(new URL(url ?? "").searchParams.get("q")).toBe("Weatherday");
  });
});

describe("fetchDeezerRelatedArtists", () => {
  it("reads related artists in Deezer's order", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          { id: 1, name: "Asian Glow" },
          { id: 2, name: "Horse Jumper of Love" },
        ],
      }),
    );

    await expect(fetchDeezerRelatedArtists(69103042)).resolves.toEqual([
      { id: 1, name: "Asian Glow" },
      { id: 2, name: "Horse Jumper of Love" },
    ]);
    expect(new URL(requestedUrls()[0] ?? "").pathname).toBe("/artist/69103042/related");
  });

  it("answers an empty list for Deezer's 'no data' error", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, { error: { type: "DataException", message: "no data", code: 800 } }),
    );

    await expect(fetchDeezerRelatedArtists(1)).resolves.toEqual([]);
  });

  it("rejects when Deezer didn't answer, so it never reads as no related artists", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () => jsonResponse(500, {}));

    await expect(fetchDeezerRelatedArtists(1)).rejects.toThrow("500");
  });
});

describe("fetchDeezerArtistTopTracks", () => {
  it("reads the artist's tracks most popular first, with their album", async () => {
    vi.mocked(tauriFetch).mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          { id: 10, title: "Come In", rank: 228151, album: { id: 3, title: "Come In" } },
          { id: 11, title: "Tiara", rank: 157953, album: { id: 4, title: "Hornet Disaster" } },
          { id: 12, title: "No album" },
        ],
      }),
    );

    await expect(fetchDeezerArtistTopTracks(69103042)).resolves.toEqual([
      { title: "Come In", albumTitle: "Come In" },
      { title: "Tiara", albumTitle: "Hornet Disaster" },
      { title: "No album", albumTitle: null },
    ]);
    expect(new URL(requestedUrls()[0] ?? "").pathname).toBe("/artist/69103042/top");
  });
});
