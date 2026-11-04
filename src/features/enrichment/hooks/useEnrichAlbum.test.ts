// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/albumBio", () => ({ fetchAlbumBio: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createMigratedTestDb, type FakeDatabase, holdSettingReads } from "../../../test/sqlite";
import { fetchAlbumBio } from "../lib/albumBio";
import { useEnrichAlbum } from "./useEnrichAlbum";

const ALBUM_ID = "srv-a:alb";
const RELEASE_GROUP = "46482030-ef12-319c-9c5a-5d04c39d574b";
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
  vi.mocked(fetchAlbumBio).mockResolvedValue({ bio: "bio", url: null });
});

function storedBio(): { album_bio: string | null; album_bio_release_group_id: string | null } | undefined {
  return db.raw
    .prepare("SELECT album_bio, album_bio_release_group_id FROM album_identity WHERE album_id = ?")
    .get(ALBUM_ID) as { album_bio: string | null; album_bio_release_group_id: string | null } | undefined;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useEnrichAlbum", () => {
  it("refreshes an album enriched longer ago than the staleness window", async () => {
    storeAlbumEnrichedDaysAgo(60);
    renderHook(() => useEnrichAlbum(ALBUM_ID, "slowdive", "Souvlaki"), { wrapper });

    await waitFor(() =>
      expect(fetchAlbumBio).toHaveBeenCalledExactlyOnceWith({
        artist: "slowdive",
        album: "Souvlaki",
        releaseGroupMbid: null,
      }),
    );
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
    expect(fetchAlbumBio).not.toHaveBeenCalled();
  });

  it("looks again once MusicBrainz matches an album described without its match", async () => {
    db.raw
      .prepare("INSERT INTO album_identity (album_id, album_bio, album_enriched_at) VALUES (?, NULL, ?)")
      .run(ALBUM_ID, Math.floor(Date.now() / 1000));
    vi.mocked(fetchAlbumBio).mockResolvedValue({ bio: "Souvlaki is the second studio album.", url: null });
    renderHook(() => useEnrichAlbum(ALBUM_ID, "Slowdive", "Souvlaki"), { wrapper });
    await waitFor(() => expect(queryClient.getQueryState(QK.albumEnrichment(ALBUM_ID))?.status).toBe("success"));
    await act(async () => {});
    expect(fetchAlbumBio).not.toHaveBeenCalled();

    db.raw.prepare("UPDATE album_identity SET mb_release_group_id = ? WHERE album_id = ?").run(RELEASE_GROUP, ALBUM_ID);
    await act(async () => queryClient.invalidateQueries({ queryKey: QK.albumIdentity(ALBUM_ID) }));

    await waitFor(() =>
      expect(fetchAlbumBio).toHaveBeenCalledExactlyOnceWith({
        artist: "Slowdive",
        album: "Souvlaki",
        releaseGroupMbid: RELEASE_GROUP,
      }),
    );
    await waitFor(() =>
      expect(storedBio()).toEqual({
        album_bio: "Souvlaki is the second studio album.",
        album_bio_release_group_id: RELEASE_GROUP,
      }),
    );
  });

  it("keeps the stored description when the lookup failed", async () => {
    storeAlbumEnrichedDaysAgo(60);
    vi.mocked(fetchAlbumBio).mockRejectedValue(new Error("Wikipedia returned 503"));
    renderHook(() => useEnrichAlbum(ALBUM_ID, "slowdive", "Souvlaki"), { wrapper });

    await waitFor(() => expect(fetchAlbumBio).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(storedBio()).toEqual({ album_bio: "old bio", album_bio_release_group_id: null });
  });
});
