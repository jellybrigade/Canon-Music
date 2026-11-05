import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { ARTIST_SEED_SQL, artistSeedParams, loadArtistSeedTrack } from "./artistSeed";

let db: FakeDatabase;

function seedTrack(serverId: string, id: string, artist: string, albumArtist: string): void {
  db.raw
    .prepare("INSERT OR IGNORE INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, ?)")
    .run(`${id}-al`, serverId, `${id} album`, albumArtist);
  db.raw
    .prepare(
      "INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', 'Song', ?, ?)",
    )
    .run(id, serverId, artist, `${id}-al`);
}

async function seedIdsOver(serverId: string, artist: string, draws = 40): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let i = 0; i < draws; i++) {
    const row = await loadArtistSeedTrack(serverId, artist);
    if (row) ids.add(row.id);
  }
  return ids;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("loadArtistSeedTrack", () => {
  it("draws from the artist's tracks, their album tracks and their merged aliases on this server only", async () => {
    seedTrack("srv-a", "srv-a:own", "Burial", "Various");
    seedTrack("srv-a", "srv-a:album", "Someone", "Burial");
    seedTrack("srv-a", "srv-a:alias", "Burial (UK)", "Various");
    seedTrack("srv-a", "srv-a:other", "Four Tet", "Four Tet");
    seedTrack("srv-b", "srv-b:own", "Burial", "Burial");
    db.raw.exec("INSERT INTO artist_aliases (alias_name, canonical_name) VALUES ('Burial (UK)', 'Burial')");

    expect(await seedIdsOver("srv-a", "Burial")).toEqual(new Set(["srv-a:own", "srv-a:album", "srv-a:alias"]));
  });

  it("returns null when the artist has no tracks here", async () => {
    seedTrack("srv-b", "srv-b:own", "Burial", "Burial");
    expect(await loadArtistSeedTrack("srv-a", "Burial")).toBeNull();
  });

  it("reaches the artist's tracks through indexes instead of walking the server's tracks", () => {
    const plan = (
      db.raw.prepare(`EXPLAIN QUERY PLAN ${ARTIST_SEED_SQL}`).all(...artistSeedParams("s", "x")) as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/^SCAN (t|a|tracks|albums)\b/m);
    expect(plan).toContain("idx_tracks_artist");
    expect(plan).toContain("idx_albums_artist");
  });
});
