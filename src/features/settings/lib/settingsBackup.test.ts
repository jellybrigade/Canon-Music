vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { readSettingsBackup, restoreSettingsBackup } from "./settingsBackup";

let db: FakeDatabase;

function setting(key: string): string | undefined {
  const row = db.raw.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
});

describe("settings backup", () => {
  it("exports preferences but not the queue, radio session, tree version or per-server state", async () => {
    const insert = db.raw.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of [
      ["player.gapless", "false"],
      ["queue_state", "{}"],
      ["radio_active", "1"],
      ["radio_seed", "{}"],
      ["radio_mode", "loved"],
      ["radio_label", "x"],
      ["genre_tree_version", "2026-01-01"],
      ["server.opensub_extensions.srv-1", "[]"],
    ]) {
      insert.run(key, value);
    }

    const exported = JSON.parse(await readSettingsBackup()) as Record<string, string>;

    expect(Object.keys(exported).filter((key) => key !== "player.gapless")).toEqual([]);
    expect(exported["player.gapless"]).toBe("false");
  });

  it("an older backup carrying a queue and tree version leaves the current ones in place", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('queue_state', 'current')").run();
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('genre_tree_version', 'new')").run();

    await restoreSettingsBackup(
      JSON.stringify({ queue_state: "old", genre_tree_version: "old", "player.gapless": "false" }),
    );

    expect(setting("queue_state")).toBe("current");
    expect(setting("genre_tree_version")).toBe("new");
    expect(setting("player.gapless")).toBe("false");
  });

  it("rejects a file that is not a settings object, writing nothing", async () => {
    await expect(restoreSettingsBackup(JSON.stringify(["player.gapless"]))).rejects.toThrow(/settings/);
    await expect(restoreSettingsBackup("null")).rejects.toThrow(/settings/);
    expect(setting("0")).toBeUndefined();
  });
});
