import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import type { MbReleaseDetail, MbReleaseGroupDetail } from "../../../clients/musicbrainz";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { mbReleaseFacts, persistAlbumIdentity } from "./useAlbumIdentity";

const group = (firstReleaseDate: string | null): Pick<MbReleaseGroupDetail, "firstReleaseDate"> => ({
  firstReleaseDate,
});

const release = (date: string | null): MbReleaseDetail => ({
  id: "rel",
  releaseGroupId: "rg",
  title: "Kind of Blue",
  date,
  country: "XE",
  label: "Columbia",
  catalogNumber: "CK 64935",
  barcode: "074646493528",
  genres: [],
  tags: [],
  trackCount: 5,
});

describe("mbReleaseFacts", () => {
  it("keeps the matched release's own date apart from the release group's first date", () => {
    expect(mbReleaseFacts(release("1997-01-01"), group("1959-08-17"))).toEqual({
      label: "Columbia",
      country: "XE",
      catalogNumber: "CK 64935",
      barcode: "074646493528",
      releaseDate: "1997-01-01",
      firstReleaseDate: "1959-08-17",
    });
  });

  it("falls back to the first date for the release date only when the release has none", () => {
    expect(mbReleaseFacts(release(null), group("1959")).releaseDate).toBe("1959");
    expect(mbReleaseFacts(null, group("1959"))).toEqual({
      label: null,
      country: null,
      catalogNumber: null,
      barcode: null,
      releaseDate: "1959",
      firstReleaseDate: "1959",
    });
  });

  it("has no dates when MusicBrainz gave none", () => {
    expect(mbReleaseFacts(undefined, undefined)).toMatchObject({ releaseDate: null, firstReleaseDate: null });
    expect(mbReleaseFacts(null, group(""))).toMatchObject({ releaseDate: null, firstReleaseDate: null });
  });
});

describe("persistAlbumIdentity", () => {
  let db: FakeDatabase;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("stores the release group's first date beside the release's own", async () => {
    await persistAlbumIdentity({
      albumId: "srv:al-1",
      mbReleaseGroupId: "rg",
      mbReleaseId: "rel",
      mbArtistId: null,
      lastfmArtistName: null,
      lastfmAlbumName: null,
      lastfmMatchConfirmed: false,
      combinedGenres: [],
      combinedTags: [],
      ...mbReleaseFacts(release("1997-01-01"), group("1959-08-17")),
    });

    const rows = await db.select<{ release_date: string; first_release_date: string }[]>(
      "SELECT release_date, first_release_date FROM album_identity",
    );
    expect(rows).toEqual([{ release_date: "1997-01-01", first_release_date: "1959-08-17" }]);
  });
});
