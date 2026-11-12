import { describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import { createMigratedTestDb } from "../../../test/sqlite";
import { findNativeArtistId } from "./useEnrichArtist";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

async function seed() {
  const db = await createMigratedTestDb();
  await db.execute(
    `INSERT INTO artists (id, server_id, server_type, name) VALUES
       ('s1:a', 's1', 'navidrome', 'Kanye West'),
       ('s1:b', 's1', 'navidrome', 'Ye')`,
  );
  await db.execute("INSERT INTO artist_aliases (alias_name, canonical_name) VALUES ('Ye', 'Kanye West')");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

describe("findNativeArtistId", () => {
  it("prefers the artist row with the exact name over the artist it was merged into", async () => {
    await seed();

    expect(await findNativeArtistId("Ye", "s1")).toBe("b");
  });

  it("falls back to the merged artist's row when the name has none of its own", async () => {
    await seed();

    expect(await findNativeArtistId("Kanye West", "s1")).toBe("a");
  });
});
