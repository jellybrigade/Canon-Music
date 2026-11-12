import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/lastfm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/lastfm")>()),
  fetchArtistTopAlbums: vi.fn(),
}));
vi.mock("../../../clients/deezer", () => ({ searchDeezerArtists: vi.fn(), fetchDeezerDiscography: vi.fn() }));
vi.mock("../../../clients/listenbrainz", () => ({ fetchListenBrainzReleaseGroupListens: vi.fn() }));

import { fetchDeezerDiscography, searchDeezerArtists } from "../../../clients/deezer";
import { fetchArtistTopAlbums } from "../../../clients/lastfm";
import { fetchListenBrainzReleaseGroupListens } from "../../../clients/listenbrainz";
import { type EssentialAlbumCandidate, fetchEssentialAlbumOrder } from "./essentialAlbums";

const COME_IN = "11111111-1111-1111-1111-111111111111";
const HITHERTO = "22222222-2222-2222-2222-222222222222";

const ALBUMS: EssentialAlbumCandidate[] = [
  { id: "a-hitherto", name: "Hitherto", releaseGroupMbid: HITHERTO },
  { id: "a-come-in", name: "Come In", releaseGroupMbid: COME_IN },
  { id: "a-weatherglow", name: "Weatherglow", releaseGroupMbid: null },
];

function order() {
  return fetchEssentialAlbumOrder({ artistName: "Weatherday", lastfmName: "Weatherday ", albums: ALBUMS });
}

function deezerArtist(): void {
  vi.mocked(searchDeezerArtists).mockResolvedValue([
    { id: 7, name: "Weatherday" },
    { id: 8, name: "Weatherday Tribute" },
  ]);
}

function deezerNothing(): void {
  vi.mocked(searchDeezerArtists).mockResolvedValue([]);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchEssentialAlbumOrder", () => {
  it("keeps Last.fm's order of this library's albums and asks nothing else", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([
      { name: "Some Album Elsewhere", playcount: 1, listeners: 1 },
      { name: "come in", playcount: 900, listeners: 10 },
      { name: "Hitherto", playcount: 100, listeners: 5 },
    ]);

    await expect(order()).resolves.toEqual(["a-come-in", "a-hitherto"]);
    expect(fetchArtistTopAlbums).toHaveBeenCalledWith("Weatherday ");
    expect(searchDeezerArtists).not.toHaveBeenCalled();
    expect(fetchListenBrainzReleaseGroupListens).not.toHaveBeenCalled();
  });

  it("orders by Deezer fans when Last.fm has none, best edition per title, albums only", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([]);
    deezerArtist();
    vi.mocked(fetchDeezerDiscography).mockResolvedValue([
      { title: "Weatherglow", recordType: "single", releaseDate: "2020-01-01", fans: 99_999 },
      { title: "Hitherto", recordType: "album", releaseDate: "2018-01-01", fans: 300 },
      { title: "Come In", recordType: "album", releaseDate: "2019-01-01", fans: 100 },
      { title: "Come In", recordType: "album", releaseDate: "2023-01-01", fans: 2512 },
      { title: "Come In (Remastered)", recordType: "album", releaseDate: "2024-01-01", fans: 50_000 },
    ]);

    await expect(order()).resolves.toEqual(["a-come-in", "a-hitherto"]);
    expect(searchDeezerArtists).toHaveBeenCalledWith("Weatherday");
    expect(fetchDeezerDiscography).toHaveBeenCalledWith(7);
    expect(fetchListenBrainzReleaseGroupListens).not.toHaveBeenCalled();
  });

  it("falls through to Deezer when Last.fm failed or ranks none of this library's albums", async () => {
    deezerArtist();
    vi.mocked(fetchDeezerDiscography).mockResolvedValue([
      { title: "Come In", recordType: "album", releaseDate: "2019-01-01", fans: 2512 },
    ]);

    vi.mocked(fetchArtistTopAlbums).mockRejectedValue(new Error("Last.fm returned 503"));
    await expect(order()).resolves.toEqual(["a-come-in"]);

    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([{ name: "Not Here", playcount: 5, listeners: 1 }]);
    await expect(order()).resolves.toEqual(["a-come-in"]);
  });

  it("orders by ListenBrainz listens of the stored release groups when Deezer can't tell", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([]);
    deezerNothing();
    vi.mocked(fetchListenBrainzReleaseGroupListens).mockResolvedValue([
      { mbid: HITHERTO, listenCount: 1200 },
      { mbid: COME_IN, listenCount: 84_559 },
    ]);

    await expect(order()).resolves.toEqual(["a-come-in", "a-hitherto"]);
    expect(fetchListenBrainzReleaseGroupListens).toHaveBeenCalledWith([HITHERTO, COME_IN]);
  });

  it("leaves out a release group ListenBrainz has no listens for", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([]);
    deezerNothing();
    vi.mocked(fetchListenBrainzReleaseGroupListens).mockResolvedValue([
      { mbid: HITHERTO, listenCount: null },
      { mbid: COME_IN, listenCount: 10 },
    ]);

    await expect(order()).resolves.toEqual(["a-come-in"]);
  });

  it("ranks nothing when every source answered with nothing", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([]);
    deezerNothing();
    vi.mocked(fetchListenBrainzReleaseGroupListens).mockResolvedValue([
      { mbid: HITHERTO, listenCount: null },
      { mbid: COME_IN, listenCount: null },
    ]);

    await expect(order()).resolves.toEqual([]);
  });

  it("asks ListenBrainz nothing when no album has a release group", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([]);
    deezerNothing();

    await expect(
      fetchEssentialAlbumOrder({
        artistName: "Weatherday",
        lastfmName: "Weatherday",
        albums: [{ id: "a", name: "Come In", releaseGroupMbid: null }],
      }),
    ).resolves.toEqual([]);
    expect(fetchListenBrainzReleaseGroupListens).not.toHaveBeenCalled();
  });

  it("rejects instead of ranking nothing when a source failed and the rest had none", async () => {
    vi.mocked(fetchArtistTopAlbums).mockResolvedValue([]);
    vi.mocked(searchDeezerArtists).mockRejectedValue(new Error("Deezer returned 502"));
    vi.mocked(fetchListenBrainzReleaseGroupListens).mockResolvedValue([]);

    await expect(order()).rejects.toThrow("Deezer returned 502");
  });

  it("takes a later source's ranking even though an earlier one failed", async () => {
    vi.mocked(fetchArtistTopAlbums).mockRejectedValue(new Error("Last.fm returned 503"));
    vi.mocked(searchDeezerArtists).mockRejectedValue(new Error("Deezer returned 502"));
    vi.mocked(fetchListenBrainzReleaseGroupListens).mockResolvedValue([{ mbid: HITHERTO, listenCount: 3 }]);

    await expect(order()).resolves.toEqual(["a-hitherto"]);
  });
});
