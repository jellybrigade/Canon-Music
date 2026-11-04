import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/keychain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/keychain")>()),
  keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { setApiKey } from "./lastfm";

let db: FakeDatabase;

function enrichedArtists(): string[] {
  return (
    db.raw
      .prepare("SELECT artist_name FROM artist_identity WHERE enriched_at IS NOT NULL ORDER BY artist_name")
      .all() as { artist_name: string }[]
  ).map((row) => row.artist_name);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  db.raw
    .prepare(
      "INSERT INTO artist_identity (artist_name, listeners, listenbrainz_listens, enriched_at) VALUES (?, ?, ?, 1)",
    )
    .run("from last.fm", 100, null);
  db.raw
    .prepare(
      "INSERT INTO artist_identity (artist_name, listeners, listenbrainz_listens, enriched_at) VALUES (?, ?, ?, 1)",
    )
    .run("from listenbrainz", null, 50);
});

describe("setApiKey", () => {
  it("makes artists enriched without Last.fm due again, so its stats replace the stand-ins", async () => {
    await setApiKey("key");

    expect(enrichedArtists()).toEqual(["from last.fm"]);
  });

  it("leaves every artist alone when the key is removed", async () => {
    await setApiKey("");

    expect(enrichedArtists()).toEqual(["from last.fm", "from listenbrainz"]);
  });
});
