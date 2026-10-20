import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { loadRandomLibraryTrack } from "./librarySeed";

let db: FakeDatabase;

function seedTrack(serverId: string, trackId: string): void {
  db.raw
    .prepare(
      "INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', 'Album', 'Artist')",
    )
    .run(`${trackId}-album`, serverId);
  db.raw
    .prepare(
      "INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', 'Song', 'Artist', ?)",
    )
    .run(trackId, serverId, `${trackId}-album`);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("loadRandomLibraryTrack", () => {
  it("picks a track from the given server only, with its album", async () => {
    seedTrack("srv-a", "mine");
    seedTrack("srv-b", "theirs");
    const track = await loadRandomLibraryTrack("srv-a");
    expect(track?.id).toBe("mine");
    expect(track?.album_name).toBe("Album");
  });

  it("draws by position from a count instead of sorting the whole library at random", async () => {
    for (const id of ["t-a", "t-b", "t-c"]) seedTrack("srv-a", id);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      expect((await loadRandomLibraryTrack("srv-a"))?.id).toBe("t-c");
      random.mockReturnValue(0);
      expect((await loadRandomLibraryTrack("srv-a"))?.id).toBe("t-a");
    } finally {
      random.mockRestore();
    }
    expect(db.queryLog.filter((q) => /RANDOM\(\)/i.test(q.sql))).toEqual([]);
  });

  it("reports an empty library as no track", async () => {
    seedTrack("srv-b", "theirs");
    expect(await loadRandomLibraryTrack("srv-a")).toBeNull();
  });
});
