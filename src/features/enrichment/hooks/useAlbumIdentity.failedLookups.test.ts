import { describe, expect, it } from "vitest";
import { migrations } from "../../../db/migrations";
import { createMigratedTestDb } from "../../../test/sqlite";
import { readFailedLookupAlbumIds, readFailedLookupAlbums, recordFailedLookup } from "./useAlbumIdentity";

async function seedTwoServers() {
  const db = await createMigratedTestDb();
  for (const [id, server] of [
    ["srv-a:al-1", "srv-a"],
    ["srv-b:al-1", "srv-b"],
    ["srv-a:al-2", "srv-a"],
  ]) {
    await db.execute(
      "INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, 'Artist')",
      [id, server, id],
    );
  }
  await db.execute(
    `INSERT INTO album_identity (album_id, mb_release_group_id, looked_up_at) VALUES
       ('srv-a:al-1', NULL, 1), ('srv-b:al-1', NULL, 1), ('srv-a:al-2', 'mbid', 1)`,
  );
  return db;
}

describe("readFailedLookupAlbums", () => {
  it("lists only the given server's albums that found no match", async () => {
    const db = await seedTwoServers();

    const rows = await readFailedLookupAlbums(db as never, "srv-a");

    expect(rows.map((row) => row.id)).toEqual(["srv-a:al-1"]);
  });

  it("counts only the album's own server's tracks", async () => {
    const db = await seedTwoServers();
    for (const [id, server] of [
      ["t-1", "srv-a"],
      ["t-2", "srv-b"],
    ]) {
      await db.execute(
        "INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES (?, ?, 'navidrome', ?, 'srv-a:al-1')",
        [id, server, id],
      );
    }

    const rows = await readFailedLookupAlbums(db as never, "srv-a");

    expect(rows.map((row) => row.track_count)).toEqual([1]);
  });

  it("sums the album's length, or reports it unknown when a track has none", async () => {
    const db = await seedTwoServers();
    const insertTrack = (id: string, server: string, duration: number | null) =>
      db.execute(
        "INSERT INTO tracks (id, server_id, server_type, title, album_id, duration) VALUES (?, ?, 'navidrome', ?, 'srv-a:al-1', ?)",
        [id, server, id, duration],
      );
    await insertTrack("t-1", "srv-a", 1200);
    await insertTrack("t-2", "srv-a", 1300);
    await insertTrack("t-3", "srv-b", 9999);

    expect((await readFailedLookupAlbums(db as never, "srv-a")).map((row) => row.duration_seconds)).toEqual([2500]);

    await insertTrack("t-4", "srv-a", null);

    expect((await readFailedLookupAlbums(db as never, "srv-a")).map((row) => row.duration_seconds)).toEqual([0]);
  });
});

describe("readFailedLookupAlbumIds", () => {
  it("lists only the given server's failed lookups, matching the Unidentified list", async () => {
    const db = await seedTwoServers();

    expect(await readFailedLookupAlbumIds(db as never, "srv-a")).toEqual(["srv-a:al-1"]);
    expect(await readFailedLookupAlbumIds(db as never, "srv-b")).toEqual(["srv-b:al-1"]);
  });
});

describe("recordFailedLookup", () => {
  async function readRow(db: Awaited<ReturnType<typeof createMigratedTestDb>>, albumId: string) {
    const rows = await db.select<{ looked_up_at: number; match_score: number; confirmed_at: number | null }[]>(
      "SELECT looked_up_at, match_score, confirmed_at FROM album_identity WHERE album_id = ?",
      [albumId],
    );
    return rows[0];
  }

  it("refreshes an earlier failed lookup so the retry clock restarts", async () => {
    const db = await seedTwoServers();

    await recordFailedLookup(db as never, { albumId: "srv-a:al-1", matchScore: 70, lookedUpAt: 500 });

    expect(await readRow(db, "srv-a:al-1")).toEqual({ looked_up_at: 500, match_score: 70, confirmed_at: null });
  });

  it("never overwrites an album the user confirmed", async () => {
    const db = await seedTwoServers();
    await db.execute("UPDATE album_identity SET confirmed_at = 9 WHERE album_id = 'srv-a:al-1'");

    await recordFailedLookup(db as never, { albumId: "srv-a:al-1", matchScore: 70, lookedUpAt: 500 });

    expect(await readRow(db, "srv-a:al-1")).toEqual({ looked_up_at: 1, match_score: null, confirmed_at: 9 });
  });
});

describe("migration 53", () => {
  it("marks automatic failed lookups due for a retry and leaves confirmed rows alone", async () => {
    const db = await seedTwoServers();
    await db.execute("UPDATE album_identity SET looked_up_at = 777 WHERE album_id = 'srv-b:al-1'");
    await db.execute("UPDATE album_identity SET confirmed_at = 9, looked_up_at = 888 WHERE album_id = 'srv-a:al-1'");

    await db.execute(migrations.find((m) => m.version === 53)?.sql ?? "");

    const rows = await db.select<{ album_id: string; looked_up_at: number }[]>(
      "SELECT album_id, looked_up_at FROM album_identity ORDER BY album_id",
    );
    expect(rows).toEqual([
      { album_id: "srv-a:al-1", looked_up_at: 888 },
      { album_id: "srv-a:al-2", looked_up_at: 1 },
      { album_id: "srv-b:al-1", looked_up_at: 0 },
    ]);
  });
});
