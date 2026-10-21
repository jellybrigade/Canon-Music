// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../clients/lastfm", () => ({ fetchAlbumInfo: vi.fn().mockResolvedValue({ bio: "bio", url: null }) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { fetchAlbumInfo } from "../../../clients/lastfm";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createMigratedTestDb, type FakeDatabase, holdSettingReads } from "../../../test/sqlite";
import { useEnrichAlbum } from "./useEnrichAlbum";

const ALBUM_ID = "srv-a:alb";
let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function storeAlbumEnrichedDaysAgo(days: number) {
  const enrichedAt = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  db.raw
    .prepare("INSERT INTO album_identity (album_id, album_bio, album_enriched_at) VALUES (?, 'old bio', ?)")
    .run(ALBUM_ID, enrichedAt);
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useEnrichAlbum", () => {
  it("refreshes an album enriched longer ago than the staleness window", async () => {
    storeAlbumEnrichedDaysAgo(60);
    renderHook(() => useEnrichAlbum(ALBUM_ID, "slowdive", "Souvlaki"), { wrapper });

    await waitFor(() => expect(fetchAlbumInfo).toHaveBeenCalledExactlyOnceWith("slowdive", "Souvlaki"));
  });

  it("leaves an album inside the stored staleness window alone, even before it is read back", async () => {
    storeAlbumEnrichedDaysAgo(60);
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('tags.staleness_days', '365')").run();
    const releaseSettings = holdSettingReads(db, "tags.staleness_days");
    renderHook(() => useEnrichAlbum(ALBUM_ID, "slowdive", "Souvlaki"), { wrapper });

    await waitFor(() => expect(queryClient.getQueryState(QK.albumEnrichment(ALBUM_ID))?.status).toBe("success"));
    await act(async () => {});
    await act(async () => releaseSettings());
    await act(async () => {});
    expect(fetchAlbumInfo).not.toHaveBeenCalled();
  });
});
