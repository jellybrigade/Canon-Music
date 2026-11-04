import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./itunesCatalog", () => ({ searchItunesArtists: vi.fn(), fetchItunesArtistAlbums: vi.fn() }));

import type { ItunesAlbum } from "../features/releaseDates/lib/itunesAlbums";
import { fetchItunesAlbumCovers, fetchItunesCoverArt } from "./itunes";
import { fetchItunesArtistAlbums, searchItunesArtists } from "./itunesCatalog";

function album(title: string, artworkUrl: string | null, overrides: Partial<ItunesAlbum> = {}): ItunesAlbum {
  return {
    title,
    recordType: "album",
    trackCount: 10,
    artistName: "PISS",
    releaseDate: "2026-10-30",
    artworkUrl,
    ...overrides,
  };
}

// From the live lookups of 2026-11-04: free-text search for this album finds nothing, but iTunes
// lists it under one of the five artists named PISS. Artists' catalogs are kept for the session,
// so each test names its own.
function answerPiss(name: string): void {
  vi.mocked(searchItunesArtists).mockResolvedValue([
    { id: 1, name },
    { id: 2, name },
    { id: 3, name: "P.I.S.S." },
  ]);
  vi.mocked(fetchItunesArtistAlbums).mockImplementation(async (artistId) => {
    if (artistId === 1) {
      return [album("Everything You Never Wanted", "https://img/old/100x100bb.jpg", { artistName: name })];
    }
    if (artistId === 2) {
      return [
        album("you made me / skin on linen", "https://img/new/100x100bb.jpg", { artistName: name }),
        album("time loop at hot slit", "https://img/single/100x100bb.jpg", {
          artistName: name,
          recordType: "single",
          trackCount: 1,
        }),
      ];
    }
    return [album("you made me / skin on linen", "https://img/stranger/100x100bb.jpg", { artistName: "P.I.S.S." })];
  });
}

afterEach(() => {
  vi.mocked(searchItunesArtists).mockReset();
  vi.mocked(fetchItunesArtistAlbums).mockReset();
});

describe("fetchItunesCoverArt", () => {
  it("finds an album through its artist's catalog, among same-named artists", async () => {
    answerPiss("PISS");

    await expect(fetchItunesCoverArt("PISS", "you made me / skin on linen")).resolves.toBe(
      "https://img/new/600x600bb.jpg",
    );
    expect(fetchItunesArtistAlbums).not.toHaveBeenCalledWith(3);
  });

  it("finds no cover when no same-named artist lists the album", async () => {
    answerPiss("PISS 2");
    await expect(fetchItunesCoverArt("PISS 2", "Rarities")).resolves.toBeNull();
  });

  it("matches the album with its edition brackets dropped", async () => {
    vi.mocked(searchItunesArtists).mockResolvedValue([{ id: 4, name: "Artist D" }]);
    vi.mocked(fetchItunesArtistAlbums).mockResolvedValue([
      album("Album Two", "https://img/two/100x100bb.jpg", { artistName: "Artist D" }),
      album("Album (Deluxe Edition)", "https://img/right/100x100bb.jpg", { artistName: "Artist D" }),
    ]);
    await expect(fetchItunesCoverArt("Artist D", "Album")).resolves.toBe("https://img/right/600x600bb.jpg");
  });

  it("reads one artist's catalog once for several of its albums", async () => {
    answerPiss("PISS 4");
    await fetchItunesCoverArt("PISS 4", "you made me / skin on linen");
    await fetchItunesCoverArt("PISS 4", "time loop at hot slit");
    expect(searchItunesArtists).toHaveBeenCalledTimes(1);
    expect(fetchItunesArtistAlbums).toHaveBeenCalledTimes(2);
  });

  it("rejects when iTunes did not answer, and asks again next time", async () => {
    vi.mocked(searchItunesArtists).mockRejectedValueOnce(new Error("iTunes returned 403"));
    await expect(fetchItunesCoverArt("Artist C", "Album")).rejects.toThrow("403");

    vi.mocked(searchItunesArtists).mockResolvedValue([{ id: 5, name: "Artist C" }]);
    vi.mocked(fetchItunesArtistAlbums).mockResolvedValue([
      album("Album", "https://img/c/100x100bb.jpg", { artistName: "Artist C" }),
    ]);
    await expect(fetchItunesCoverArt("Artist C", "Album")).resolves.toBe("https://img/c/600x600bb.jpg");
  });

  it("rejects when a same-named artist's catalog failed and no other had the album", async () => {
    answerPiss("PISS 6");
    vi.mocked(fetchItunesArtistAlbums).mockRejectedValueOnce(new Error("iTunes returned 503"));
    await expect(fetchItunesCoverArt("PISS 6", "Rarities")).rejects.toThrow("503");
  });
});

describe("fetchItunesAlbumCovers", () => {
  it("lists every edition of the same artist and album, each image once", async () => {
    vi.mocked(searchItunesArtists).mockResolvedValue([
      { id: 6, name: "Artist L" },
      { id: 7, name: "Someone Else" },
    ]);
    vi.mocked(fetchItunesArtistAlbums).mockResolvedValue([
      album("Album (Deluxe)", "https://is1-ssl.img/b/100x100bb.jpg", { artistName: "Artist L" }),
      album("Album", "https://is4-ssl.img/b/100x100bb.jpg", { artistName: "Artist L" }),
      album("Album", "https://img/c/100x100bb.jpg", { artistName: "Artist L", recordType: "single" }),
      album("Album", null, { artistName: "Artist L" }),
      album("Other Album", "https://img/d/100x100bb.jpg", { artistName: "Artist L" }),
    ]);

    await expect(fetchItunesAlbumCovers("Artist L", "Album")).resolves.toEqual([
      { thumbUrl: "https://is1-ssl.img/b/600x600bb.jpg", fullUrl: "https://is1-ssl.img/b/1200x1200bb.jpg" },
      { thumbUrl: "https://img/c/600x600bb.jpg", fullUrl: "https://img/c/1200x1200bb.jpg" },
    ]);
    expect(fetchItunesArtistAlbums).not.toHaveBeenCalledWith(7);
  });

  it("fails when iTunes did not answer", async () => {
    vi.mocked(searchItunesArtists).mockRejectedValue(new Error("iTunes returned 503"));
    await expect(fetchItunesAlbumCovers("Artist M", "Album")).rejects.toThrow("503");
  });
});
