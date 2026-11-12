import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { readArtistByName } from "./artistByName";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
});

function seedArtist(serverId: string, name: string): void {
  db.raw
    .prepare("INSERT INTO artists (id, server_id, server_type, name) VALUES (?, ?, 'navidrome', ?)")
    .run(`${serverId}:ar-${name}`, serverId, name);
}

function seedAlbum(serverId: string, id: string, options: { artist: string; artwork: string; created: string }): void {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, artwork_url, navidrome_created)
       VALUES (?, ?, 'navidrome', ?, ?, 2000, ?, ?)`,
    )
    .run(`${serverId}:${id}`, serverId, id, options.artist, options.artwork, options.created);
}

describe("readArtistByName", () => {
  it("shows the same cover as the artist grid: the newest album's", async () => {
    seedArtist("s", "Low");
    seedAlbum("s", "old", { artist: "Low", artwork: "old-art", created: "2001-01-01" });
    seedAlbum("s", "new", { artist: "Low", artwork: "new-art", created: "2021-01-01" });

    const artist = await readArtistByName(db as never, "Low", "s");

    expect(artist?.artwork_url).toBe("new-art");
  });

  it("prefers the exact spelling when two artists differ only in case", async () => {
    seedArtist("s", "Tyler, the Creator");
    seedArtist("s", "Tyler, The Creator");

    expect((await readArtistByName(db as never, "Tyler, The Creator", "s"))?.name).toBe("Tyler, The Creator");
    expect((await readArtistByName(db as never, "Tyler, the Creator", "s"))?.name).toBe("Tyler, the Creator");
  });

  it("finds the library's spelling of a name given in another case", async () => {
    seedArtist("s", "Tyler, The Creator");

    expect((await readArtistByName(db as never, " tyler, the creator ", "s"))?.name).toBe("Tyler, The Creator");
  });

  it("finds nothing on another server", async () => {
    seedArtist("other", "Low");

    expect(await readArtistByName(db as never, "Low", "s")).toBeNull();
  });
});
