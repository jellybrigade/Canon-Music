import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { resyncLibrary } from "./resyncLibrary";

let db: FakeDatabase;

const SERVER = { server: { id: "srv" } } as ServerWithCredential;

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  db.raw
    .prepare(
      "INSERT INTO servers (id, type, url, display_name, username, last_scan_at) VALUES ('srv', 'navidrome', 'http://nd', 'Home', 'u', '2026-01-01')",
    )
    .run();
});

describe("resyncLibrary", () => {
  it("forgets the server's watermark and runs one forced track pass", async () => {
    const runSync = vi.fn(() => true);
    await resyncLibrary(SERVER, runSync);
    const row = db.raw.prepare("SELECT last_scan_at FROM servers WHERE id = 'srv'").get() as { last_scan_at: unknown };
    expect(row.last_scan_at).toBeNull();
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(SERVER, { forceTrackPass: true });
  });
});
