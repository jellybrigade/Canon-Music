// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { usePlayerStore } from "../../playback/store/player";
import { importSettingsFile, readSettingsBackup, restoreSettingsBackup } from "./settingsBackup";

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

  // Older builds kept the Last.fm key in settings; a backup is a file on disk, and keys belong in the keychain.
  it("never exports or imports a key stored by an older build", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('lastfm.api_key', 'secret')").run();
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('player.gapless', 'false')").run();

    expect(JSON.parse(await readSettingsBackup())).toEqual({ "player.gapless": "false" });

    db.raw.prepare("DELETE FROM settings WHERE key = 'lastfm.api_key'").run();
    await restoreSettingsBackup(JSON.stringify({ "lastfm.api_key": "from-file" }));
    expect(setting("lastfm.api_key")).toBeUndefined();
  });

  it("rejects a file that is not a settings object, writing nothing", async () => {
    await expect(restoreSettingsBackup(JSON.stringify(["player.gapless"]))).rejects.toThrow(/settings/);
    await expect(restoreSettingsBackup("null")).rejects.toThrow(/settings/);
    expect(setting("0")).toBeUndefined();
  });

  it("an imported file reaches playback without a restart", async () => {
    usePlayerStore.setState({ gapless: true, replayGainMode: "off" });

    await importSettingsFile(
      new File([JSON.stringify({ "player.gapless": "false", "player.replay_gain_mode": "album" })], "backup.json"),
    );

    expect(usePlayerStore.getState().gapless).toBe(false);
    expect(usePlayerStore.getState().replayGainMode).toBe("album");
  });
});
