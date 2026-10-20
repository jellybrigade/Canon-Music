import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it } from "vitest";
import { OTHER, SRV } from "../../test/navidromeFixtures";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { RECENTS_LIMIT, readRecents, recordRecent } from "./recents";

let db: FakeDatabase;
const asDb = (d: FakeDatabase) => d as unknown as Database;

const album = (id: string, serverId = SRV) => ({ kind: "album" as const, serverId, albumId: `${serverId}:${id}` });
const artist = (artistName: string, serverId = SRV) => ({ kind: "artist" as const, serverId, artistName });
const track = (id: string, serverId = SRV) => ({ kind: "track" as const, serverId, trackId: `${serverId}:${id}` });

const keysOf = async (serverId = SRV) => (await readRecents(asDb(db), serverId)).map((item) => item.key);

beforeEach(async () => {
  db = await createMigratedTestDb();
  const albums = Array.from(
    { length: 7 },
    (_, i) => `('${SRV}:al-${i}', '${SRV}', 'navidrome', 'Album ${i}', 'Artist One', 'co-${i}')`,
  );
  db.raw.exec(`
    INSERT INTO albums (id, server_id, server_type, name, artist, artwork_url) VALUES
      ${albums.join(",\n      ")},
      ('${OTHER}:al-9', '${OTHER}', 'navidrome', 'Elsewhere', 'Artist One', NULL);
    INSERT INTO artists (id, server_id, server_type, name, album_count) VALUES
      ('a1', '${SRV}', 'navidrome', 'Artist One', 7),
      ('a9', '${OTHER}', 'navidrome', 'Artist One', 1);
    INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES
      ('${SRV}:t1', '${SRV}', 'navidrome', 'Song One', 'Artist One', '${SRV}:al-1');
  `);
});

describe("recordRecent / readRecents", () => {
  it("reads every kind back as one list, last opened first", async () => {
    await recordRecent(asDb(db), album("al-1"), 1);
    await recordRecent(asDb(db), track("t1"), 2);
    await recordRecent(asDb(db), artist("Artist One"), 3);

    const items = await readRecents(asDb(db), SRV);
    expect(items.map((item) => item.key)).toEqual(["artist:Artist One", `track:${SRV}:t1`, `album:${SRV}:al-1`]);
    const [first, second, third] = items;
    expect(first?.kind === "artist" && first.artist.album_count).toBe(7);
    expect(second?.kind === "track" && [second.track.album_name, second.track.artwork_url]).toEqual([
      "Album 1",
      "co-1",
    ]);
    expect(third?.kind === "album" && third.album.artwork_url).toBe("co-1");
  });

  it("records an artist who appears only on tracks, not as an album artist", async () => {
    db.raw.exec(`INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES
      ('${SRV}:t2', '${SRV}', 'navidrome', 'Feature', 'Guest Only', '${SRV}:al-1')`);
    await recordRecent(asDb(db), artist("Guest Only"), 1);

    const [item] = await readRecents(asDb(db), SRV);
    expect(item?.kind === "artist" && [item.artist.name, item.artist.album_count]).toEqual(["Guest Only", 1]);
  });

  it("moves an item opened again to the front instead of listing it twice", async () => {
    await recordRecent(asDb(db), album("al-1"), 1);
    await recordRecent(asDb(db), album("al-2"), 2);
    await recordRecent(asDb(db), album("al-1"), 3);

    expect(await keysOf()).toEqual([`album:${SRV}:al-1`, `album:${SRV}:al-2`]);
  });

  it(`keeps only the last ${RECENTS_LIMIT}, in the list and on disk`, async () => {
    for (let i = 0; i < 7; i++) await recordRecent(asDb(db), album(`al-${i}`), i);

    expect(await keysOf()).toEqual([6, 5, 4, 3, 2].map((i) => `album:${SRV}:al-${i}`));
    const rows = await db.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM recent_albums");
    expect(rows[0]?.c).toBe(RECENTS_LIMIT);
  });

  it("scopes the list to the server the item belongs to", async () => {
    await recordRecent(asDb(db), album("al-9", OTHER), 1);
    await recordRecent(asDb(db), artist("Artist One", OTHER), 2);

    expect(await keysOf(SRV)).toEqual([]);
    expect(await keysOf(OTHER)).toEqual(["artist:Artist One", `album:${OTHER}:al-9`]);
  });

  it("trims each server's list on its own", async () => {
    await recordRecent(asDb(db), album("al-9", OTHER), 0);
    for (let i = 0; i < 7; i++) await recordRecent(asDb(db), album(`al-${i}`), i + 1);

    expect(await keysOf(OTHER)).toEqual([`album:${OTHER}:al-9`]);
  });

  it("writes nothing for an item the library does not hold, and hides one that has gone", async () => {
    await recordRecent(asDb(db), album("gone"), 1);
    await recordRecent(asDb(db), artist("Nobody"), 1);
    await recordRecent(asDb(db), track("gone"), 1);
    for (const table of ["recent_albums", "recent_artists", "recent_tracks"]) {
      const rows = await db.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM ${table}`);
      expect({ table, rows: rows[0]?.c }).toEqual({ table, rows: 0 });
    }

    await recordRecent(asDb(db), track("t1"), 2);
    db.raw.exec(`DELETE FROM tracks`);
    expect(await keysOf()).toEqual([]);
  });
});
