// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { useRecentlyReleasedAlbums } from "./useRecentlyReleasedAlbums";

let db: FakeDatabase;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

afterEach(() => {
  cleanup();
});

interface SeedAlbum {
  id: string;
  name?: string;
  year: number | null;
  releaseDate?: string;
  originalDate?: string;
  identifiedDate?: string;
  firstReleaseDate?: string;
  addedAt?: string;
}

function seed(album: SeedAlbum): void {
  const { id, name = id, year, releaseDate, originalDate, identifiedDate, firstReleaseDate, addedAt } = album;
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, release_date, original_release_date, navidrome_created)
       VALUES (?, 's', 'navidrome', ?, 'Artist', ?, ?, ?, ?)`,
    )
    .run(id, name, year, releaseDate ?? null, originalDate ?? null, addedAt ?? null);
  if (identifiedDate !== undefined || firstReleaseDate !== undefined) {
    db.raw
      .prepare("INSERT INTO album_identity (album_id, release_date, first_release_date) VALUES (?, ?, ?)")
      .run(id, identifiedDate ?? null, firstReleaseDate ?? null);
  }
}

async function recentIds(limit?: number): Promise<string[]> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useRecentlyReleasedAlbums("s", limit), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  return (result.current.data ?? []).map((a) => a.id);
}

describe("useRecentlyReleasedAlbums", () => {
  it("ranks an album out this week above same-year albums whatever its name", async () => {
    seed({ id: "a", name: "A Early", year: 2026, releaseDate: "2026-01-10" });
    seed({ id: "b", name: "B Spring", year: 2026, identifiedDate: "2026-04-02" });
    seed({ id: "y", name: "you made me / skin on linen", year: 2026, identifiedDate: "2026-10-30" });
    expect(await recentIds(2)).toEqual(["y", "b"]);
  });

  it("puts a year-only album below the dated albums of its year, and above older years", async () => {
    seed({ id: "yearOnly", year: 2026 });
    seed({ id: "dated", year: 2026, releaseDate: "2026-02-01" });
    seed({ id: "older", year: 2025, releaseDate: "2025-12-31" });
    expect(await recentIds()).toEqual(["dated", "yearOnly", "older"]);
  });

  it("prefers the files' own full date over the identified one", async () => {
    seed({ id: "tagged", year: 2026, releaseDate: "2026-09-01", identifiedDate: "2026-01-01" });
    seed({ id: "middle", year: 2026, releaseDate: "2026-05-01" });
    expect(await recentIds()).toEqual(["tagged", "middle"]);
  });

  it("ignores a date from another year than the album's", async () => {
    seed({ id: "taggedOther", year: 2023, releaseDate: "2026-05-01" });
    seed({ id: "originalOther", year: 2022, originalDate: "2026-05-01" });
    seed({ id: "old", year: 2020 });
    expect(await recentIds()).toEqual(["taggedOther", "originalOther", "old"]);
  });

  it("dates an album by its tagged original date when the tags name no release date", async () => {
    seed({ id: "yearOnly", year: 2025, addedAt: "2026-10-01T00:00:00Z" });
    seed({ id: "willoughby", year: 2025, originalDate: "2025-08-08" });
    seed({ id: "older", year: 2024, releaseDate: "2024-12-31" });
    expect(await recentIds()).toEqual(["willoughby", "yearOnly", "older"]);
  });

  it("ranks the tagged release date over the original date, and the original date over MusicBrainz", async () => {
    seed({ id: "middle", year: 2026, releaseDate: "2026-05-01" });
    seed({ id: "taggedEarly", year: 2026, releaseDate: "2026-03-01", originalDate: "2026-09-01" });
    seed({ id: "originalLate", year: 2026, originalDate: "2026-09-01", identifiedDate: "2026-01-01" });
    expect(await recentIds()).toEqual(["originalLate", "middle", "taggedEarly"]);
  });

  describe("leaves out reissues", () => {
    it("whose tagged original year is earlier than the album's year or tagged release year", async () => {
      seed({ id: "yearSwappedNot", year: 2026, originalDate: "1959-08-17" });
      seed({ id: "editionTagged", year: 2026, releaseDate: "2026-05-01", originalDate: "1959" });
      seed({ id: "new", year: 2026 });
      expect(await recentIds()).toEqual(["new"]);
    });

    it("that MusicBrainz says first came out in an earlier year, by the group's or the release's date", async () => {
      seed({ id: "remaster", year: 2026, identifiedDate: "2026-04-01", firstReleaseDate: "1959-08-17" });
      seed({ id: "identifiedBeforeFirstDates", year: 2024, identifiedDate: "1975-11-21" });
      seed({ id: "new", year: 2026, identifiedDate: "2026-02-01", firstReleaseDate: "2026-02-01" });
      expect(await recentIds()).toEqual(["new"]);
    });

    it("whose title names a remaster, reissue, anniversary or legacy edition in brackets", async () => {
      for (const name of [
        "Kind of Blue (2026 Remaster)",
        "Dirt (Remastered)",
        "Nevermind [Reissue]",
        "Hard Normal Daddy (Reissue, DOCdata UK)",
        "NUM-HEAVYMETALLIC (15th Anniversary Edition)",
        "Kind of Blue (Legacy Edition)",
      ]) {
        seed({ id: name, year: 2026 });
      }
      seed({ id: "new", year: 2026 });
      expect(await recentIds()).toEqual(["new"]);
    });

    it("but keeps a deluxe edition of its own year, and a title using those words outside brackets", async () => {
      seed({ id: "deluxe", name: "Debut (Deluxe Edition)", year: 2026, originalDate: "2026-01-09", addedAt: "2" });
      seed({ id: "titled", name: "Reissue Blues", year: 2026, addedAt: "1" });
      seed({ id: "sameYear", year: 2026, releaseDate: "2026-11-01", originalDate: "2026-02-01" });
      expect(await recentIds()).toEqual(["sameYear", "deluxe", "titled"]);
    });

    it("and a deluxe edition whose original date is earlier", async () => {
      seed({ id: "deluxe", name: "Debut (Deluxe Edition)", year: 2026, originalDate: "2024-03-01" });
      seed({ id: "new", year: 2026 });
      expect(await recentIds()).toEqual(["new"]);
    });
  });

  describe("a date looked up on Deezer", () => {
    function lookup(albumId: string, row: { date?: string | null; status?: string; reissue?: boolean; name?: string }) {
      const { date = null, status = "found", reissue = false, name = albumId } = row;
      db.raw
        .prepare(
          `INSERT INTO album_release_lookups
             (album_id, server_id, source, release_date, is_reissue, looked_up_name, looked_up_artist, looked_up_year, status, checked_at)
           VALUES (?, 's', 'deezer', ?, ?, ?, 'Artist', 2026, ?, 1)`,
        )
        .run(albumId, date, reissue ? 1 : 0, name, status);
    }

    it("puts the PISS album, tagged only 2026, first", async () => {
      seed({ id: "spring", year: 2026, releaseDate: "2026-04-01", addedAt: "2" });
      seed({ id: "piss", year: 2026, addedAt: "1" });
      lookup("piss", { date: "2026-10-30" });
      expect(await recentIds()).toEqual(["piss", "spring"]);
    });

    it("ranks below the tags' and MusicBrainz's own dates", async () => {
      seed({ id: "identified", year: 2026, identifiedDate: "2026-03-01" });
      lookup("identified", { date: "2026-10-30" });
      seed({ id: "middle", year: 2026, releaseDate: "2026-05-01" });
      expect(await recentIds()).toEqual(["middle", "identified"]);
    });

    it("counts only a found date of the album's year, for the album as it was looked up", async () => {
      seed({ id: "otherYear", year: 2026, addedAt: "3" });
      lookup("otherYear", { date: "2021-05-01" });
      seed({ id: "renamed", year: 2026, addedAt: "2" });
      lookup("renamed", { date: "2026-12-01", name: "Old Name" });
      seed({ id: "spring", year: 2026, releaseDate: "2026-04-01", addedAt: "1" });
      expect(await recentIds()).toEqual(["spring", "otherYear", "renamed"]);
    });

    it("leaves out an album Deezer shows came out long before", async () => {
      seed({ id: "kob", name: "kob", year: 2026 });
      lookup("kob", { status: "none", reissue: true });
      seed({ id: "new", year: 2026 });
      expect(await recentIds()).toEqual(["new"]);
    });
  });

  it("breaks a tie on the same date by the newest added, then by id", async () => {
    seed({ id: "a", year: 2026, addedAt: "2026-01-01T00:00:00Z" });
    seed({ id: "c", year: 2026, addedAt: "2026-10-30T08:31:13Z" });
    seed({ id: "b", year: 2026 });
    seed({ id: "d", year: 2026 });
    expect(await recentIds()).toEqual(["c", "a", "b", "d"]);
  });

  it("fills the list from older years when the newest year holds only reissues", async () => {
    for (const id of ["r1", "r2", "r3"]) seed({ id, name: `${id} (Remastered)`, year: 2026 });
    seed({ id: "a", year: 2025 });
    seed({ id: "b", year: 2024 });
    seed({ id: "c", year: 2023 });
    expect(await recentIds(2)).toEqual(["a", "b"]);
  });

  it("ranks every album of the last year that fits, not only the first ones found", async () => {
    seed({ id: "new", year: 2026 });
    seed({ id: "a", year: 2025 });
    seed({ id: "b", year: 2025 });
    seed({ id: "z", year: 2025, releaseDate: "2025-12-01" });
    seed({ id: "old", year: 2024, releaseDate: "2024-12-31" });
    expect(await recentIds(2)).toEqual(["new", "z"]);
  });

  it("leaves out albums with no year", async () => {
    seed({ id: "none", year: null, releaseDate: "2026-10-30" });
    seed({ id: "dated", year: 2026 });
    expect(await recentIds()).toEqual(["dated"]);
  });
});
