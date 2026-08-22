// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useEnrichAlbumTracks.ts` - the on-open per-track tag enrichment.
 *
 * Regression pinned: known-issues "A claim stamped when work starts, and cleared only when it
 * succeeds, is permanent after the first failure". `ranRef` is stamped before the run, so the
 * rejection path owes it a decision; without one an album that fails once stays unenriched for
 * as long as the view is open. The clear must not re-enter on its own either - the deps are what
 * re-trigger the effect, so a failed run costs exactly one attempt.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/lastfm", () => ({ fetchTrackTags: vi.fn() }));
vi.mock("../lib/tag-normalize", () => ({ normalizeAlbum: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/canonicalize", () => ({
  getCanonTree: vi.fn().mockResolvedValue({ nodes: [] }),
  findCanonicalSync: vi.fn().mockReturnValue({ node: null }),
}));

import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchTrackTags } from "../lib/lastfm";
import { QK } from "../lib/query-keys";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { useEnrichAlbumTracks } from "./useEnrichAlbumTracks";

const ALBUM_ID = "srv-a:alb";
const OTHER_ALBUM_ID = "srv-a:alb2";
const TRACKS_SELECT = "SELECT id, title, artist, album_artist, tags_enriched_at";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

let realSelect: FakeDatabase["select"];

/** Makes the hook's opening read of `tracks` reject, as a locked database would. */
function failTrackRead() {
  realSelect = db.select.bind(db);
  db.select = <T,>(sql: string, binds?: unknown[]): Promise<T> => {
    if (sql.trim().startsWith(TRACKS_SELECT)) {
      db.queryLog.push({ kind: "select", sql: sql.trim() });
      return Promise.reject(new Error("database is locked"));
    }
    return realSelect<T>(sql, binds);
  };
}

function restoreTrackRead() {
  db.select = realSelect;
}

/** A second album on the same server, as a navigation target within one `AlbumDetail` mount. */
function insertOtherAlbum() {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, 'srv-a', 'navidrome', ?, 'my bloody valentine')`
    )
    .run(OTHER_ALBUM_ID, "Isn't Anything");
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id)
       VALUES (?, 'srv-a', 'navidrome', ?, 'my bloody valentine', ?)`
    )
    .run("srv-a:t2", "Soft As Snow", OTHER_ALBUM_ID);
}

function trackTagRows(): { track_id: string; raw_value: string }[] {
  return db.raw
    .prepare("SELECT track_id, raw_value FROM track_tags ORDER BY track_id, raw_value")
    .all() as { track_id: string; raw_value: string }[];
}

/**
 * Re-triggers the effect the way the app does: identifying the album rewrites `album_identity`
 * and invalidates its query, which is a dep of the effect. A bare refetch would not do it -
 * React Query's structural sharing hands back the same reference when the row is unchanged.
 */
async function reidentifyAlbum() {
  db.raw
    .prepare("UPDATE album_identity SET lastfm_album_name = 'loveless (deluxe)' WHERE album_id = ?")
    .run(ALBUM_ID);
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: QK.albumIdentity(ALBUM_ID) });
  });
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(fetchTrackTags).mockResolvedValue({ genres: ["shoegaze"], moods: [] });

  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, 'srv-a', 'navidrome', 'Loveless', 'my bloody valentine')`
    )
    .run(ALBUM_ID);
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id)
       VALUES (?, 'srv-a', 'navidrome', ?, 'my bloody valentine', ?)`
    )
    .run("srv-a:t1", "Only Shallow", ALBUM_ID);
  // A stored identity row, so the identity query resolves to an object that can later change.
  // Without a row it resolves to a stable `null`, which can never re-trigger the effect.
  db.raw
    .prepare(
      `INSERT INTO album_identity (album_id, lastfm_artist_name, lastfm_album_name, lastfm_match_confirmed, auto_matched)
       VALUES (?, 'my bloody valentine', 'loveless', 1, 0)`
    )
    .run(ALBUM_ID);

  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useEnrichAlbumTracks", () => {
  it("writes Last.fm tags for a stale track", async () => {
    renderHook(() => useEnrichAlbumTracks(ALBUM_ID, "my bloody valentine", "Loveless"), { wrapper });

    await waitFor(() => expect(trackTagRows()).toHaveLength(1));
    expect(trackTagRows()[0]).toMatchObject({ track_id: "srv-a:t1", raw_value: "shoegaze" });
  });

  it("enriches on a later run after a failed one, without leaving the album unenriched", async () => {
    failTrackRead();
    renderHook(() => useEnrichAlbumTracks(ALBUM_ID, "my bloody valentine", "Loveless"), { wrapper });

    await waitFor(() =>
      expect(db.queryLog.some((q) => q.sql.startsWith(TRACKS_SELECT))).toBe(true)
    );
    expect(trackTagRows()).toHaveLength(0);

    // Database recovers, then re-identifying the album re-triggers the effect.
    restoreTrackRead();
    await reidentifyAlbum();

    await waitFor(() => expect(trackTagRows()).toHaveLength(1));
  });

  it("enriches the second album when the view swaps albums without remounting", async () => {
    insertOtherAlbum();
    const { rerender } = renderHook(
      ({ id, name }: { id: string; name: string }) =>
        useEnrichAlbumTracks(id, "my bloody valentine", name),
      { wrapper, initialProps: { id: ALBUM_ID, name: "Loveless" } }
    );

    await waitFor(() => expect(trackTagRows()).toHaveLength(1));

    rerender({ id: OTHER_ALBUM_ID, name: "Isn't Anything" });

    await waitFor(() => expect(trackTagRows()).toHaveLength(2));
    expect(trackTagRows().map((r) => r.track_id)).toEqual(["srv-a:t1", "srv-a:t2"]);
  });

  it("costs exactly one attempt per trigger after a failure, never a retry loop", async () => {
    failTrackRead();
    renderHook(() => useEnrichAlbumTracks(ALBUM_ID, "my bloody valentine", "Loveless"), { wrapper });

    await waitFor(() =>
      expect(db.queryLog.filter((q) => q.sql.startsWith(TRACKS_SELECT))).toHaveLength(1)
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(db.queryLog.filter((q) => q.sql.startsWith(TRACKS_SELECT))).toHaveLength(1);
  });
});
