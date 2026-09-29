import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { loadGenreSeedTracks } from "./genreSeed";

let db: FakeDatabase;

function seedAlbum(serverId: string, albumId: string, relation: "direct" | "ancestor"): void {
  db.raw
    .prepare("INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, 'Artist')")
    .run(albumId, serverId, albumId);
  db.raw
    .prepare("INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', 'Song', 'Artist', ?)")
    .run(`${albumId}-t`, serverId, albumId);
  db.raw
    .prepare("INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES (?, 'shoegaze', ?, 'Shoegaze')")
    .run(albumId, relation);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("loadGenreSeedTracks", () => {
  it("only returns tracks from the requested server", async () => {
    seedAlbum("srv-a", "srv-a:al1", "direct");
    seedAlbum("srv-b", "srv-b:al2", "direct");
    const rows = await loadGenreSeedTracks({ serverId: "srv-a", canonicalId: "shoegaze", isDirectOnly: false });
    expect(rows.map((row) => row.id)).toEqual(["srv-a:al1-t"]);
  });

  it("skips ancestor tags when asked for direct matches", async () => {
    seedAlbum("srv-a", "srv-a:al1", "direct");
    seedAlbum("srv-a", "srv-a:al2", "ancestor");
    const direct = await loadGenreSeedTracks({ serverId: "srv-a", canonicalId: "shoegaze", isDirectOnly: true });
    expect(direct.map((row) => row.id)).toEqual(["srv-a:al1-t"]);
    const all = await loadGenreSeedTracks({ serverId: "srv-a", canonicalId: "shoegaze", isDirectOnly: false });
    expect(all).toHaveLength(2);
  });
});
