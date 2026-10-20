import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it } from "vitest";
import { OTHER, SRV } from "../../test/navidromeFixtures";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { type Pins, pinsNewestFirst, readPins, setPinned } from "./pins";

let db: FakeDatabase;
const asDb = (d: FakeDatabase) => d as unknown as Database;

beforeEach(async () => {
  db = await createMigratedTestDb();
  db.raw.exec(`
    INSERT INTO albums (id, server_id, server_type, name, artist, artwork_url) VALUES
      ('${SRV}:al-1', '${SRV}', 'navidrome', 'First', 'Artist One', 'co-1'),
      ('${SRV}:al-2', '${SRV}', 'navidrome', 'Second', 'Artist Two', NULL),
      ('${OTHER}:al-9', '${OTHER}', 'navidrome', 'Elsewhere', 'Artist One', NULL);
    INSERT INTO artists (id, server_id, server_type, name, album_count) VALUES
      ('a1', '${SRV}', 'navidrome', 'Artist One', 1),
      ('a2', '${SRV}', 'navidrome', 'Artist Two', 1),
      ('a9', '${OTHER}', 'navidrome', 'Artist One', 1);
  `);
});

describe("setPinned / readPins", () => {
  it("reads nothing before anything is pinned", async () => {
    expect(await readPins(asDb(db), SRV)).toEqual({ artists: [], albums: [] });
  });

  it("pins and reads back one of each kind", async () => {
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, true, 1);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist One" }, true, 1);

    const pins = await readPins(asDb(db), SRV);
    expect(pins.albums.map((a) => [a.id, a.server_id, a.name, a.artwork_url])).toEqual([
      [`${SRV}:al-1`, SRV, "First", "co-1"],
    ]);
    expect(pins.artists.map((a) => [a.name, a.album_count])).toEqual([["Artist One", 1]]);
  });

  it("orders each column newest pin first", async () => {
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, true, 1);
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-2` }, true, 2);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist One" }, true, 1);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist Two" }, true, 2);

    const pins = await readPins(asDb(db), SRV);
    expect(pins.albums.map((a) => a.id)).toEqual([`${SRV}:al-2`, `${SRV}:al-1`]);
    expect(pins.artists.map((a) => a.name)).toEqual(["Artist Two", "Artist One"]);
  });

  it("keeps the first pin time when pinned again", async () => {
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, true, 1);
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-2` }, true, 2);
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, true, 3);

    expect((await readPins(asDb(db), SRV)).albums.map((a) => a.id)).toEqual([`${SRV}:al-2`, `${SRV}:al-1`]);
  });

  it("unpins", async () => {
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, true, 1);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist One" }, true, 1);
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, false);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist One" }, false);

    expect(await readPins(asDb(db), SRV)).toEqual({ artists: [], albums: [] });
  });

  it("scopes every column to the server the item belongs to", async () => {
    await setPinned(asDb(db), { kind: "album", serverId: OTHER, albumId: `${OTHER}:al-9` }, true, 1);
    await setPinned(asDb(db), { kind: "artist", serverId: OTHER, artistName: "Artist One" }, true, 1);

    expect(await readPins(asDb(db), SRV)).toEqual({ artists: [], albums: [] });
    const other = await readPins(asDb(db), OTHER);
    expect(other.albums.map((a) => a.id)).toEqual([`${OTHER}:al-9`]);
    expect(other.artists.map((a) => a.name)).toEqual(["Artist One"]);
  });

  it("writes no pin for an id the library does not hold", async () => {
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:gone` }, true, 1);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Nobody" }, true, 1);

    for (const table of ["pinned_albums", "pinned_artists"]) {
      const rows = await db.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM ${table}`);
      expect({ table, rows: rows[0]?.c }).toEqual({ table, rows: 0 });
    }
  });
});

describe("pinsNewestFirst", () => {
  it("merges every kind into one list, newest pin first", async () => {
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist One" }, true, 1);
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` }, true, 3);
    await setPinned(asDb(db), { kind: "artist", serverId: SRV, artistName: "Artist Two" }, true, 2);
    await setPinned(asDb(db), { kind: "album", serverId: SRV, albumId: `${SRV}:al-2` }, true, 4);

    const items = pinsNewestFirst(await readPins(asDb(db), SRV));
    expect(items.map((item) => [item.kind, item.key])).toEqual([
      ["album", `album:${SRV}:al-2`],
      ["album", `album:${SRV}:al-1`],
      ["artist", "artist:Artist Two"],
      ["artist", "artist:Artist One"],
    ]);
  });

  it("breaks a tie in pin time by kind", () => {
    const pins: Pins = {
      artists: [
        {
          name: "B",
          album_count: 1,
          lastfm_image_url: null,
          wikidata_image_url: null,
          navidrome_image_url: null,
          pinned_at: 5,
        },
      ],
      albums: [{ id: "a", server_id: SRV, name: "A", artist: null, year: null, artwork_url: null, pinned_at: 5 }],
    };
    expect(pinsNewestFirst(pins).map((item) => item.key)).toEqual(["album:a", "artist:B"]);
  });
});
