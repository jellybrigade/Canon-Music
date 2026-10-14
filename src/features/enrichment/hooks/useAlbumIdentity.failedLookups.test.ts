import { describe, expect, it } from "vitest";
import { createMigratedTestDb } from "../../../test/sqlite";
import { readFailedLookupAlbumIds, readFailedLookupAlbums } from "./useAlbumIdentity";

async function seedTwoServers() {
  const db = await createMigratedTestDb();
  for (const [id, server] of [["srv-a:al-1", "srv-a"], ["srv-b:al-1", "srv-b"], ["srv-a:al-2", "srv-a"]]) {
    await db.execute(
      "INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, 'Artist')",
      [id, server, id]
    );
  }
  await db.execute(
    `INSERT INTO album_identity (album_id, mb_release_group_id, looked_up_at) VALUES
       ('srv-a:al-1', NULL, 1), ('srv-b:al-1', NULL, 1), ('srv-a:al-2', 'mbid', 1)`
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
    for (const [id, server] of [["t-1", "srv-a"], ["t-2", "srv-b"]]) {
      await db.execute(
        "INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES (?, ?, 'navidrome', ?, 'srv-a:al-1')",
        [id, server, id]
      );
    }

    const rows = await readFailedLookupAlbums(db as never, "srv-a");

    expect(rows.map((row) => row.track_count)).toEqual([1]);
  });
});

describe("readFailedLookupAlbumIds", () => {
  it("lists only the given server's failed lookups, matching the Unidentified list", async () => {
    const db = await seedTwoServers();

    expect(await readFailedLookupAlbumIds(db as never, "srv-a")).toEqual(["srv-a:al-1"]);
    expect(await readFailedLookupAlbumIds(db as never, "srv-b")).toEqual(["srv-b:al-1"]);
  });
});
