import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../clients/discogs", () => ({
  searchDiscogsReleases: vi.fn(),
  fetchDiscogsMainReleaseId: vi.fn(),
  fetchDiscogsRelease: vi.fn(),
}));
vi.mock("../../clients/musicbrainz", () => ({ fetchReleaseGroupDiscogsMasterId: vi.fn() }));

import { fetchDiscogsMainReleaseId, fetchDiscogsRelease, searchDiscogsReleases } from "../../clients/discogs";
import { fetchReleaseGroupDiscogsMasterId } from "../../clients/musicbrainz";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { DISCOGS_LOOKUP_RETRY_SECONDS, runDiscogsLookups } from "./discogsLookups";
import type { DiscogsRelease } from "./lib/discogsMatch";

const NOW = new Date("2026-11-05T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

let db: FakeDatabase;

interface SeedAlbum {
  id: string;
  name?: string;
  artist?: string;
  tracks?: number;
  releaseGroupId?: string;
  identityLabel?: string;
}

function seed(album: SeedAlbum): void {
  const { id, name = "you made me / skin on linen", artist = "PISS" } = album;
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, release_type)
       VALUES (?, 's', 'navidrome', ?, ?, 2026, 'album')`,
    )
    .run(id, name, artist);
  for (let i = 0; i < (album.tracks ?? 15); i++) {
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES (?, 's', 'navidrome', ?, ?)")
      .run(`${id}-t${i}`, `T${i}`, id);
  }
  if (album.releaseGroupId !== undefined || album.identityLabel !== undefined) {
    db.raw
      .prepare("INSERT INTO album_identity (album_id, mb_release_group_id, label) VALUES (?, ?, ?)")
      .run(id, album.releaseGroupId ?? null, album.identityLabel ?? null);
  }
}

function rows() {
  return db.raw
    .prepare(
      `SELECT album_id, discogs_release_id, label, catalog_number, country, styles_json, genres_json,
              looked_up_name, status, checked_at
       FROM album_discogs ORDER BY album_id`,
    )
    .all();
}

const PISS_RELEASE: DiscogsRelease = {
  id: 38888610,
  title: "you made me / skin on linen",
  artistNames: ["PISS (16)"],
  labels: [{ name: "Paper Bag Records", catalogNumber: "PAPER166CD" }],
  country: "Canada",
  styles: ["Shoegaze", "Noise Rock"],
  genres: ["Rock"],
  trackCount: 15,
  formatDescriptions: ["Album"],
};

function answerPissSearch(): void {
  vi.mocked(searchDiscogsReleases).mockResolvedValue([
    {
      id: 38888610,
      masterId: 4391529,
      artistName: "PISS (16)",
      title: "you made me / skin on linen",
      year: 2026,
    },
  ]);
  vi.mocked(fetchDiscogsMainReleaseId).mockResolvedValue(38888610);
  vi.mocked(fetchDiscogsRelease).mockResolvedValue(PISS_RELEASE);
}

function run(options: Partial<Parameters<typeof runDiscogsLookups>[2]> = {}, now = NOW) {
  return runDiscogsLookups(db, now, { shouldStop: () => false, onFound: () => {}, ...options });
}

beforeEach(async () => {
  vi.resetAllMocks();
  db = await createMigratedTestDb();
});

describe("runDiscogsLookups", () => {
  it("finds the album by search, reads its master's main release and stores the facts", async () => {
    seed({ id: "a1" });
    answerPissSearch();
    const onFound = vi.fn();

    await run({ onFound });

    expect(searchDiscogsReleases).toHaveBeenCalledWith("PISS", "you made me / skin on linen");
    expect(fetchDiscogsMainReleaseId).toHaveBeenCalledWith(4391529);
    expect(fetchDiscogsRelease).toHaveBeenCalledWith(38888610);
    expect(rows()).toEqual([
      {
        album_id: "a1",
        discogs_release_id: 38888610,
        label: "Paper Bag Records",
        catalog_number: "PAPER166CD",
        country: "Canada",
        styles_json: '["Shoegaze","Noise Rock"]',
        genres_json: '["Rock"]',
        looked_up_name: "you made me / skin on linen",
        status: "found",
        checked_at: NOW_SECONDS,
      },
    ]);
    expect(onFound).toHaveBeenCalledWith({ albumId: "a1", serverId: "s" });
  });

  it("follows the MusicBrainz link to Discogs without searching or checking the track count", async () => {
    seed({ id: "a1", releaseGroupId: "rg", tracks: 30 });
    vi.mocked(fetchReleaseGroupDiscogsMasterId).mockResolvedValue(4391529);
    vi.mocked(fetchDiscogsMainReleaseId).mockResolvedValue(38888610);
    vi.mocked(fetchDiscogsRelease).mockResolvedValue(PISS_RELEASE);

    await run();

    expect(fetchReleaseGroupDiscogsMasterId).toHaveBeenCalledWith("rg");
    expect(searchDiscogsReleases).not.toHaveBeenCalled();
    expect(rows()).toMatchObject([{ status: "found", label: "Paper Bag Records" }]);
  });

  it("searches when MusicBrainz has no link", async () => {
    seed({ id: "a1", releaseGroupId: "rg" });
    vi.mocked(fetchReleaseGroupDiscogsMasterId).mockResolvedValue(null);
    answerPissSearch();

    await run();

    expect(searchDiscogsReleases).toHaveBeenCalledTimes(1);
    expect(rows()).toMatchObject([{ status: "found" }]);
  });

  it("records a failure, not none, when MusicBrainz didn't answer and the search found nothing", async () => {
    seed({ id: "a1", releaseGroupId: "rg" });
    seed({ id: "a2" });
    vi.mocked(fetchReleaseGroupDiscogsMasterId).mockRejectedValue(new Error("MusicBrainz returned 503"));
    vi.mocked(searchDiscogsReleases).mockResolvedValue([]);

    await run();

    expect(rows()).toMatchObject([
      { album_id: "a1", status: "failed" },
      { album_id: "a2", status: "none" },
    ]);
  });

  it("records none when no hit names the album, and asks again only after the retry interval", async () => {
    seed({ id: "a1" });
    vi.mocked(searchDiscogsReleases).mockResolvedValue([
      { id: 1, masterId: null, artistName: "P.I.S.S.", title: "you made me / skin on linen", year: 2026 },
    ]);

    await run();
    expect(rows()).toMatchObject([{ status: "none", discogs_release_id: null, label: null }]);
    expect(fetchDiscogsRelease).not.toHaveBeenCalled();

    await run({}, new Date(NOW.getTime() + 1000));
    expect(searchDiscogsReleases).toHaveBeenCalledTimes(1);

    await run({}, new Date(NOW.getTime() + DISCOGS_LOOKUP_RETRY_SECONDS * 1000));
    expect(searchDiscogsReleases).toHaveBeenCalledTimes(2);
  });

  it("records none when the release found has clearly more tracks than the album", async () => {
    seed({ id: "a1", tracks: 8 });
    answerPissSearch();

    await run();

    expect(rows()).toMatchObject([{ status: "none", label: null }]);
  });

  it("stops the pass at the first Discogs failure and asks that album again next pass", async () => {
    seed({ id: "a1" });
    seed({ id: "a2" });
    vi.mocked(searchDiscogsReleases).mockRejectedValue(new Error("Discogs /database/search returned 401"));

    await run();

    expect(searchDiscogsReleases).toHaveBeenCalledTimes(1);
    expect(rows()).toMatchObject([{ album_id: "a1", status: "failed" }]);

    answerPissSearch();
    await run({}, new Date(NOW.getTime() + 1000));
    expect(rows()).toMatchObject([
      { album_id: "a1", status: "found" },
      { album_id: "a2", status: "found" },
    ]);
  });

  it("asks again about an album renamed since its lookup", async () => {
    seed({ id: "a1" });
    answerPissSearch();
    await run();

    db.raw.prepare("UPDATE albums SET name = 'skin on linen' WHERE id = 'a1'").run();
    vi.mocked(searchDiscogsReleases).mockResolvedValue([]);
    await run({}, new Date(NOW.getTime() + 1000));

    expect(searchDiscogsReleases).toHaveBeenLastCalledWith("PISS", "skin on linen");
    expect(rows()).toMatchObject([{ status: "none", looked_up_name: "skin on linen", label: null }]);
  });

  it("stops before the next album once asked to", async () => {
    seed({ id: "a1" });
    seed({ id: "a2" });
    answerPissSearch();
    let isStopRequested = false;

    await run({
      shouldStop: () => isStopRequested,
      onFound: () => {
        isStopRequested = true;
      },
    });

    expect(rows()).toMatchObject([{ album_id: "a1" }]);
  });

  it("asks about albums without a MusicBrainz label first and skips various-artists albums", async () => {
    seed({ id: "a1", identityLabel: "Sub Pop" });
    seed({ id: "a2" });
    seed({ id: "a3", artist: "Various Artists" });
    const asked: string[] = [];
    vi.mocked(searchDiscogsReleases).mockImplementation(async (artist) => {
      asked.push(artist);
      return [];
    });
    db.raw.prepare("UPDATE albums SET artist = 'First' WHERE id = 'a2'").run();

    await run();

    expect(asked).toEqual(["First", "PISS"]);
  });
});
