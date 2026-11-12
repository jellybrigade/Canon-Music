import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../clients/deezer", () => ({ searchDeezerAlbums: vi.fn() }));
vi.mock("../../clients/itunes", () => ({ fetchItunesCoverArt: vi.fn() }));

import { type DeezerAlbumSearchHit, searchDeezerAlbums } from "../../clients/deezer";
import { fetchItunesCoverArt } from "../../clients/itunes";
import { fetchFallbackCover } from "./fallbackCover";

function deezerHit(overrides: Partial<DeezerAlbumSearchHit>): DeezerAlbumSearchHit {
  return {
    id: 1042239632,
    title: "you made me / skin on linen",
    recordType: "album",
    trackCount: 15,
    artistId: 419317862,
    artistName: "PISS",
    coverUrl: "https://cdn-images.dzcdn.net/piss.jpg",
    ...overrides,
  };
}

afterEach(() => {
  vi.mocked(searchDeezerAlbums).mockReset();
  vi.mocked(fetchItunesCoverArt).mockReset();
});

// Answers are kept for the session, so each test names its own album.
describe("fetchFallbackCover", () => {
  it("shows Deezer's cover for the same artist and album without asking iTunes", async () => {
    vi.mocked(searchDeezerAlbums).mockResolvedValue([deezerHit({})]);

    await expect(fetchFallbackCover("PISS", "you made me / skin on linen")).resolves.toBe(
      "https://cdn-images.dzcdn.net/piss.jpg",
    );
    expect(fetchItunesCoverArt).not.toHaveBeenCalled();
  });

  it("skips a Deezer hit by a same-looking artist or of another album", async () => {
    vi.mocked(searchDeezerAlbums).mockResolvedValue([
      deezerHit({ title: "Second", artistName: "P.I.S.S.", coverUrl: "https://cdn/stranger.jpg" }),
      deezerHit({ title: "Second Thoughts", coverUrl: "https://cdn/other.jpg" }),
      deezerHit({ title: "Second (Deluxe)", coverUrl: "https://cdn/right.jpg" }),
    ]);

    await expect(fetchFallbackCover("PISS", "Second")).resolves.toBe("https://cdn/right.jpg");
  });

  it("asks iTunes when Deezer has no cover for the album", async () => {
    vi.mocked(searchDeezerAlbums).mockResolvedValue([deezerHit({ title: "Third", coverUrl: null })]);
    vi.mocked(fetchItunesCoverArt).mockResolvedValue("https://itunes/third.jpg");

    await expect(fetchFallbackCover("PISS", "Third")).resolves.toBe("https://itunes/third.jpg");
    expect(fetchItunesCoverArt).toHaveBeenCalledWith("PISS", "Third");
  });

  it("asks iTunes when Deezer didn't answer", async () => {
    vi.mocked(searchDeezerAlbums).mockRejectedValue(new Error("Deezer returned 502"));
    vi.mocked(fetchItunesCoverArt).mockResolvedValue("https://itunes/fourth.jpg");

    await expect(fetchFallbackCover("PISS", "Fourth")).resolves.toBe("https://itunes/fourth.jpg");
  });

  it("keeps the answer, a missing cover too, and asks nobody again", async () => {
    vi.mocked(searchDeezerAlbums).mockResolvedValue([]);
    vi.mocked(fetchItunesCoverArt).mockResolvedValue(null);

    await expect(fetchFallbackCover("PISS", "Fifth")).resolves.toBeNull();
    await expect(fetchFallbackCover("PISS", "Fifth")).resolves.toBeNull();
    expect(searchDeezerAlbums).toHaveBeenCalledTimes(1);
    expect(fetchItunesCoverArt).toHaveBeenCalledTimes(1);
  });

  it("rejects without keeping anything when a source failed and none had a cover", async () => {
    vi.mocked(searchDeezerAlbums).mockRejectedValueOnce(new Error("Deezer returned 502"));
    vi.mocked(fetchItunesCoverArt).mockResolvedValueOnce(null);
    await expect(fetchFallbackCover("PISS", "Sixth")).rejects.toThrow("502");

    vi.mocked(searchDeezerAlbums).mockResolvedValue([]);
    vi.mocked(fetchItunesCoverArt).mockRejectedValueOnce(new Error("iTunes returned 403"));
    await expect(fetchFallbackCover("PISS", "Sixth")).rejects.toThrow("403");

    vi.mocked(fetchItunesCoverArt).mockResolvedValue("https://itunes/sixth.jpg");
    await expect(fetchFallbackCover("PISS", "Sixth")).resolves.toBe("https://itunes/sixth.jpg");
  });

  it("asks nobody without an artist and album name", async () => {
    await expect(fetchFallbackCover(null, "Album")).resolves.toBeNull();
    await expect(fetchFallbackCover("PISS", null)).resolves.toBeNull();
    expect(searchDeezerAlbums).not.toHaveBeenCalled();
  });
});
