import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../clients/deezer", () => ({
  searchDeezerAlbums: vi.fn(),
  fetchDeezerAlbum: vi.fn(),
  fetchDeezerDiscography: vi.fn(),
}));
vi.mock("../../clients/itunesCatalog", () => ({
  searchItunesArtists: vi.fn(),
  fetchItunesArtistAlbums: vi.fn(),
}));

import { fetchDeezerAlbum, fetchDeezerDiscography, searchDeezerAlbums } from "../../clients/deezer";
import { fetchItunesArtistAlbums, searchItunesArtists } from "../../clients/itunesCatalog";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { RELEASE_LOOKUP_RETRY_SECONDS, runReleaseDateLookups } from "./releaseDateLookups";

const NOW = new Date("2026-11-04T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

let db: FakeDatabase;

interface SeedAlbum {
  id: string;
  name?: string;
  artist?: string;
  year?: number | null;
  releaseType?: string | null;
  tracks?: number;
  releaseDate?: string;
  identifiedDate?: string;
}

function seed(album: SeedAlbum): void {
  const { id, name = "you made me / skin on linen", artist = "PISS", year = 2026, releaseType = "album" } = album;
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, release_type, release_date)
       VALUES (?, 's', 'navidrome', ?, ?, ?, ?, ?)`,
    )
    .run(id, name, artist, year, releaseType, album.releaseDate ?? null);
  for (let i = 0; i < (album.tracks ?? 15); i++) {
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES (?, 's', 'navidrome', ?, ?)")
      .run(`${id}-t${i}`, `T${i}`, id);
  }
  if (album.identifiedDate !== undefined) {
    db.raw.prepare("INSERT INTO album_identity (album_id, release_date) VALUES (?, ?)").run(id, album.identifiedDate);
  }
}

function lookupRows(source = "deezer") {
  return db.raw
    .prepare(
      `SELECT album_id, server_id, source, release_date, label, record_type, is_reissue,
              looked_up_name, looked_up_artist, looked_up_year, status, checked_at
       FROM album_release_lookups WHERE source = ? ORDER BY album_id`,
    )
    .all(source);
}

function answerPissAlbum(): void {
  vi.mocked(searchDeezerAlbums).mockResolvedValue([
    {
      id: 1042239632,
      title: "you made me / skin on linen",
      recordType: "album",
      trackCount: 15,
      artistId: 419317862,
      artistName: "PISS",
      coverUrl: null,
    },
  ]);
  vi.mocked(fetchDeezerAlbum).mockResolvedValue({
    releaseDate: "2026-10-30",
    label: "Sub Pop Records",
    recordType: "album",
  });
  vi.mocked(fetchDeezerDiscography).mockResolvedValue([
    { title: "you made me / skin on linen", recordType: "album", releaseDate: "2026-10-30" },
  ]);
}

function answerDeezerNothing(): void {
  vi.mocked(searchDeezerAlbums).mockResolvedValue([]);
  vi.mocked(fetchDeezerDiscography).mockResolvedValue([]);
}

// From the live iTunes lookup (2026-11-04): four artists are named PISS, one is P.I.S.S.
function answerItunesPiss(): void {
  vi.mocked(searchItunesArtists).mockResolvedValue([
    { id: 6796357519, name: "PISS" },
    { id: 202470876, name: "PISS" },
    { id: 1565732890, name: "P.I.S.S." },
  ]);
  vi.mocked(fetchItunesArtistAlbums).mockImplementation(async (artistId) => {
    if (artistId === 6796357519) {
      return [
        {
          title: "you made me / skin on linen",
          recordType: "album",
          trackCount: 15,
          artistName: "PISS",
          releaseDate: "2026-10-30",
          artworkUrl: null,
        },
        {
          title: "time loop at hot slit",
          recordType: "single",
          trackCount: 1,
          artistName: "PISS",
          releaseDate: "2026-09-02",
          artworkUrl: null,
        },
      ];
    }
    if (artistId === 202470876) {
      return [
        {
          title: "Everything You Never Wanted",
          recordType: "album",
          trackCount: 9,
          artistName: "PISS",
          releaseDate: "2023-06-30",
          artworkUrl: null,
        },
      ];
    }
    return [
      {
        title: "you made me / skin on linen",
        recordType: "album",
        trackCount: 15,
        artistName: "P.I.S.S.",
        releaseDate: "2026-01-02",
        artworkUrl: null,
      },
    ];
  });
}

function itunesRows() {
  return lookupRows("itunes");
}

function run(at: Date = NOW) {
  return runReleaseDateLookups(db as never, at);
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(searchItunesArtists).mockResolvedValue([]);
  db = await createMigratedTestDb();
});

describe("runReleaseDateLookups", () => {
  it("stores the Deezer date of a recent album that has only a year", async () => {
    seed({ id: "piss" });
    answerPissAlbum();

    await expect(run()).resolves.toEqual({ changed: true });

    expect(lookupRows()).toEqual([
      {
        album_id: "piss",
        server_id: "s",
        source: "deezer",
        release_date: "2026-10-30",
        label: "Sub Pop Records",
        record_type: "album",
        is_reissue: 0,
        looked_up_name: "you made me / skin on linen",
        looked_up_artist: "PISS",
        looked_up_year: 2026,
        status: "found",
        checked_at: NOW_SECONDS,
      },
    ]);
  });

  it("looks up only recent, undated, non-compilation albums", async () => {
    seed({ id: "old", year: 2020 });
    seed({ id: "undated", year: null });
    seed({ id: "tagged", releaseDate: "2026-10-30" });
    seed({ id: "identified", identifiedDate: "2026-10-30" });
    seed({ id: "various", artist: "Various Artists" });
    seed({ id: "remaster", name: "Old Record (2026 Remaster)" });
    seed({ id: "last-year", year: 2025 });
    vi.mocked(searchDeezerAlbums).mockResolvedValue([]);
    vi.mocked(fetchDeezerDiscography).mockResolvedValue([]);

    await run();

    expect(lookupRows().map((row) => (row as { album_id: string }).album_id)).toEqual(["last-year"]);
  });

  it("writes nothing on a second pass over unchanged albums", async () => {
    seed({ id: "piss" });
    answerPissAlbum();
    await run();
    vi.mocked(searchDeezerAlbums).mockClear();
    const writesBefore = db.executeCount;

    await expect(run()).resolves.toEqual({ changed: false });

    expect(searchDeezerAlbums).toHaveBeenCalledTimes(0);
    expect(db.executeCount).toBe(writesBefore);
  });

  it("looks a renamed album up again", async () => {
    seed({ id: "piss" });
    answerPissAlbum();
    await run();
    db.raw.prepare("UPDATE albums SET name = 'time loop at hot slit', release_type = 'single' WHERE id = 'piss'").run();
    db.raw.prepare("DELETE FROM tracks WHERE id != 'piss-t0'").run();
    vi.mocked(searchDeezerAlbums).mockClear();

    await run();

    expect(searchDeezerAlbums).toHaveBeenCalledWith("PISS", "time loop at hot slit");
    // The search still answers the album, which a single must not take.
    expect(lookupRows()).toMatchObject([
      { status: "none", release_date: null, looked_up_name: "time loop at hot slit" },
    ]);
  });

  it("records a failed lookup and retries it on the next pass", async () => {
    seed({ id: "piss" });
    vi.mocked(searchDeezerAlbums).mockRejectedValue(new Error("Deezer returned 502"));

    await expect(run()).resolves.toEqual({ changed: false });
    expect(lookupRows()).toMatchObject([{ status: "failed", release_date: null }]);

    answerPissAlbum();
    await run();
    expect(lookupRows()).toMatchObject([{ status: "found", release_date: "2026-10-30" }]);
  });

  it("does not store 'none' when only the edition lookup failed", async () => {
    seed({ id: "piss" });
    answerPissAlbum();
    vi.mocked(fetchDeezerAlbum).mockRejectedValue(new Error("timeout"));

    await run();

    expect(lookupRows()).toMatchObject([{ status: "failed" }]);
  });

  it("asks again about an album Deezer didn't know only after the retry window", async () => {
    seed({ id: "piss" });
    vi.mocked(searchDeezerAlbums).mockResolvedValue([]);
    vi.mocked(fetchDeezerDiscography).mockResolvedValue([]);
    await run();
    expect(lookupRows()).toMatchObject([{ status: "none" }]);

    vi.mocked(searchDeezerAlbums).mockClear();
    await run(new Date(NOW.getTime() + (RELEASE_LOOKUP_RETRY_SECONDS - 60) * 1000));
    expect(searchDeezerAlbums).toHaveBeenCalledTimes(0);

    await run(new Date(NOW.getTime() + (RELEASE_LOOKUP_RETRY_SECONDS + 60) * 1000));
    expect(searchDeezerAlbums).toHaveBeenCalledTimes(1);
  });

  it("reads each artist's discography once per pass", async () => {
    seed({ id: "piss" });
    seed({ id: "piss-2", name: "another record" });
    answerPissAlbum();

    await run();

    expect(fetchDeezerDiscography).toHaveBeenCalledTimes(1);
  });

  it("marks a reissue the artist's discography gives away", async () => {
    seed({ id: "kob", name: "Kind of Blue", artist: "Miles Davis", tracks: 5 });
    vi.mocked(searchDeezerAlbums).mockResolvedValue([
      {
        id: 7,
        title: "Kind of Blue (Remastered)",
        recordType: "album",
        trackCount: 5,
        artistId: 9,
        artistName: "Miles Davis",
        coverUrl: null,
      },
    ]);
    vi.mocked(fetchDeezerDiscography).mockResolvedValue([
      { title: "Kind of Blue (Remastered)", recordType: "album", releaseDate: "2019-07-26" },
    ]);

    await expect(run()).resolves.toEqual({ changed: true });

    expect(fetchDeezerAlbum).toHaveBeenCalledTimes(0);
    expect(lookupRows()).toMatchObject([{ status: "none", is_reissue: 1 }]);
  });
});

describe("runReleaseDateLookups, iTunes fallback", () => {
  it("dates an album Deezer didn't know from the same-named artist's iTunes releases", async () => {
    seed({ id: "piss" });
    answerDeezerNothing();
    answerItunesPiss();

    await expect(run()).resolves.toEqual({ changed: true });

    expect(searchItunesArtists).toHaveBeenCalledWith("PISS");
    expect(fetchItunesArtistAlbums).not.toHaveBeenCalledWith(1565732890);
    expect(itunesRows()).toEqual([
      {
        album_id: "piss",
        server_id: "s",
        source: "itunes",
        release_date: "2026-10-30",
        label: null,
        record_type: "album",
        is_reissue: 0,
        looked_up_name: "you made me / skin on linen",
        looked_up_artist: "PISS",
        looked_up_year: 2026,
        status: "found",
        checked_at: NOW_SECONDS,
      },
    ]);
  });

  it("asks iTunes only once Deezer has answered that it doesn't know the album", async () => {
    seed({ id: "found" });
    seed({ id: "failed", name: "another record" });
    answerPissAlbum();
    vi.mocked(searchDeezerAlbums).mockImplementation(async (_artist, title) => {
      if (title === "another record") throw new Error("Deezer returned 502");
      return [
        {
          id: 1042239632,
          title: "you made me / skin on linen",
          recordType: "album",
          trackCount: 15,
          artistId: 419317862,
          artistName: "PISS",
          coverUrl: null,
        },
      ];
    });
    answerItunesPiss();

    await run();

    expect(searchItunesArtists).toHaveBeenCalledTimes(0);
    expect(itunesRows()).toEqual([]);
  });

  it("never gives a single its album's date", async () => {
    seed({ id: "single", name: "you made me / skin on linen", releaseType: "single", tracks: 1 });
    answerDeezerNothing();
    answerItunesPiss();

    await run();

    expect(itunesRows()).toMatchObject([{ status: "none", release_date: null }]);
  });

  it("reads each artist's iTunes releases once per pass", async () => {
    seed({ id: "piss" });
    seed({ id: "piss-2", name: "another record" });
    answerDeezerNothing();
    answerItunesPiss();

    await run();

    expect(searchItunesArtists).toHaveBeenCalledTimes(1);
    expect(fetchItunesArtistAlbums).toHaveBeenCalledTimes(2);
  });

  it("records iTunes refusing a request as failed, not as no date, and asks again next pass", async () => {
    seed({ id: "piss" });
    answerDeezerNothing();
    vi.mocked(searchItunesArtists).mockRejectedValue(new Error("iTunes returned 403"));

    await expect(run()).resolves.toEqual({ changed: false });
    expect(itunesRows()).toMatchObject([{ status: "failed" }]);

    answerItunesPiss();
    await run();
    expect(itunesRows()).toMatchObject([{ status: "found", release_date: "2026-10-30" }]);
  });

  it("writes nothing on a second pass over unchanged albums", async () => {
    seed({ id: "piss" });
    answerDeezerNothing();
    answerItunesPiss();
    await run();
    vi.mocked(searchItunesArtists).mockClear();
    const writesBefore = db.executeCount;

    await expect(run()).resolves.toEqual({ changed: false });

    expect(searchItunesArtists).toHaveBeenCalledTimes(0);
    expect(db.executeCount).toBe(writesBefore);
  });
});
