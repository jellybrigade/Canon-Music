// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../clients/lastfm", () => ({
  fetchArtistInfo: vi.fn().mockResolvedValue({
    bio: "bio",
    listeners: 1,
    playcount: 2,
    similar: [],
    topTags: [],
    imageUrl: null,
    url: null,
  }),
}));
vi.mock("../lib/tagNormalize", () => ({ normalizeAlbum: vi.fn().mockResolvedValue(undefined) }));

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { fetchArtistInfo } from "../../../clients/lastfm";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { createMigratedTestDb, type FakeDatabase, holdSettingReads } from "../../../test/sqlite";
import { useBackgroundNormalizer } from "./useBackgroundNormalizer";

let db: FakeDatabase;

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  db.raw
    .prepare("INSERT INTO artists (id, server_id, server_type, name) VALUES ('srv-a:ar-1', 'srv-a', 'navidrome', ?)")
    .run("slowdive");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useBackgroundNormalizer", () => {
  it("enriches a stale artist in the background", async () => {
    renderHook(() => useBackgroundNormalizer());

    await waitFor(() => expect(fetchArtistInfo).toHaveBeenCalledExactlyOnceWith("slowdive"));
  });

  it("stays idle when background refresh is off, even before the setting is read back", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('tags.auto_refresh', 'false')").run();
    const releaseSettings = holdSettingReads(db, "tags.auto_refresh");
    renderHook(() => useBackgroundNormalizer());

    await act(async () => {});
    await act(async () => releaseSettings());
    await act(async () => {});
    expect(db.queryLog.some((q) => q.sql.includes("FROM albums"))).toBe(false);
    expect(fetchArtistInfo).not.toHaveBeenCalled();
  });
});
