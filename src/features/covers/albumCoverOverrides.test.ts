import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import * as nav from "../../clients/navidromeUrls";
import { getDb } from "../../db";
import { onInvoke, resetTauriMocks } from "../../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { chooseAlbumCover, clearAlbumCover, loadCoverOverrides } from "./albumCoverOverrides";

let db: FakeDatabase;

const choice = {
  source: "caa",
  sourceRef: "release:abc",
  fullUrl: "https://coverartarchive.org/x-1200.jpg",
  width: 1200,
  height: 1200,
};

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  resetTauriMocks();
  nav.initCoverServer();
  nav.replaceCoverRevisions(new Map());
});

function rows() {
  return db.select<{ server_id: string; album_id: string; mime: string | null }[]>(
    "SELECT server_id, album_id, mime FROM album_cover_overrides ORDER BY album_id",
  );
}

describe("chooseAlbumCover", () => {
  it("stores the image, records the row and changes the album's cover URL", async () => {
    onInvoke("save_album_cover_override", () => "image/png");
    await chooseAlbumCover({ serverId: "srv", albumId: "srv:abc", choice, now: 1700 });

    expect(invoke).toHaveBeenCalledWith("save_album_cover_override", {
      serverId: "srv",
      albumId: "srv:abc",
      url: choice.fullUrl,
    });
    expect(await rows()).toEqual([{ server_id: "srv", album_id: "srv:abc", mime: "image/png" }]);
    expect(nav.getCoverArtUrl("http://x", "u", { type: "apikey", apiKey: "k" }, "al-abc_ff")).toContain("&v=1700");
  });

  it("records nothing when the image could not be stored", async () => {
    onInvoke("save_album_cover_override", () => {
      throw new Error("The host sent text/html, not an image");
    });
    await expect(chooseAlbumCover({ serverId: "srv", albumId: "srv:abc", choice, now: 1 })).rejects.toThrow(
      "not an image",
    );
    expect(await rows()).toEqual([]);
    expect(nav.getCoverArtUrl("http://x", "u", { type: "apikey", apiKey: "k" }, "al-abc_ff")).not.toContain("&v=");
  });

  it("takes the stored image back when the row cannot be written", async () => {
    onInvoke("save_album_cover_override", () => "image/jpeg");
    vi.mocked(getDb).mockResolvedValue({
      execute: vi.fn().mockRejectedValue(new Error("database is locked")),
    } as never);
    await expect(chooseAlbumCover({ serverId: "srv", albumId: "srv:abc", choice, now: 1 })).rejects.toThrow("locked");
    expect(invoke).toHaveBeenCalledWith("clear_album_cover_override", { serverId: "srv", albumId: "srv:abc" });
  });
});

describe("clearAlbumCover", () => {
  it("removes the row and the stored image and gives the server's cover its URL back", async () => {
    onInvoke("save_album_cover_override", () => "image/jpeg");
    await chooseAlbumCover({ serverId: "srv", albumId: "srv:abc", choice, now: 5 });

    await clearAlbumCover({ serverId: "srv", albumId: "srv:abc" });

    expect(await rows()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("clear_album_cover_override", { serverId: "srv", albumId: "srv:abc" });
    expect(nav.getCoverArtUrl("http://x", "u", { type: "apikey", apiKey: "k" }, "al-abc_ff")).not.toContain("&v=");
  });
});

describe("loadCoverOverrides", () => {
  it("hands every server's rows to the sweep and serves only the active server's", async () => {
    await db.execute(
      `INSERT INTO album_cover_overrides (server_id, album_id, source, full_url, chosen_at) VALUES
       ('srv', 'srv:abc', 'caa', 'u', 10), ('other', 'other:abc', 'caa', 'u', 20)`,
    );

    await loadCoverOverrides("srv");

    expect(invoke).toHaveBeenCalledWith("sync_cover_overrides", {
      activeServerId: "srv",
      rows: [
        { serverId: "other", albumId: "other:abc" },
        { serverId: "srv", albumId: "srv:abc" },
      ],
    });
    expect(nav.getCoverArtUrl("http://x", "u", { type: "apikey", apiKey: "k" }, "al-abc_ff")).toContain("&v=10");
  });
});
