// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useAlbumAccent.ts` - the accent color the album page and the home
 * spotlight tint themselves with.
 *
 * The color is derived by decoding the cover art and is cached on the `albums` row, so the
 * only thing worth asserting is that it is derived *once*. The route that renders the album
 * reads that row through React Query, so a write nothing invalidates is invisible to it for
 * the whole 60s staleTime and every revisit inside that window decodes the image again.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/artColor", () => ({ extractAccent: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { extractAccent } from "../lib/artColor";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { QK } from "../lib/queryKeys";
import { useAlbumAccent } from "./useAlbumAccent";

const SERVER_ID = "srv-a";
const ALBUM_ID = "srv-a:alb1";
const ART_URL = "cover://srv-a/alb1";
const COLOR = "rgb(120, 30, 40)";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function storedAccent(): string | null | undefined {
  const row = db.raw
    .prepare("SELECT accent_color FROM albums WHERE id = ?")
    .get(ALBUM_ID) as { accent_color: string | null } | undefined;
  return row?.accent_color;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  await db.execute(
    "INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, ?, ?, ?)",
    [ALBUM_ID, SERVER_ID, "navidrome", "Loveless", "my bloody valentine"]
  );
  // The seed above is not work the hook did; count from zero.
  db.executeCount = 0;
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(extractAccent).mockResolvedValue(COLOR);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useAlbumAccent", () => {
  it("derives a missing accent color and stores it on the album row", async () => {
    const view = renderHook(
      () => useAlbumAccent(ALBUM_ID, null, ART_URL, SERVER_ID),
      { wrapper }
    );
    await waitFor(() => expect(view.result.current).toBe(COLOR));
    await waitFor(() => expect(storedAccent()).toBe(COLOR));
    expect(extractAccent).toHaveBeenCalledTimes(1);
  });

  it("invalidates the album row the detail route renders, so the write is visible to it", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useAlbumAccent(ALBUM_ID, null, ART_URL, SERVER_ID), { wrapper });
    await waitFor(() => expect(storedAccent()).toBe(COLOR));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QK.albumById(ALBUM_ID, SERVER_ID) });
  });

  it("decodes the cover once across a revisit that reads the stored color back", async () => {
    const first = renderHook(
      () => useAlbumAccent(ALBUM_ID, null, ART_URL, SERVER_ID),
      { wrapper }
    );
    await waitFor(() => expect(storedAccent()).toBe(COLOR));
    first.unmount();

    // What the route hands back once its query has been invalidated and refetched.
    const second = renderHook(
      () => useAlbumAccent(ALBUM_ID, storedAccent(), ART_URL, SERVER_ID),
      { wrapper }
    );
    await waitFor(() => expect(second.result.current).toBe(COLOR));
    expect(extractAccent).toHaveBeenCalledTimes(1);
    expect(db.executeCount).toBe(1);
  });

  it("does not decode a cover for an album that already has a color", async () => {
    const view = renderHook(
      () => useAlbumAccent(ALBUM_ID, COLOR, ART_URL, SERVER_ID),
      { wrapper }
    );
    await waitFor(() => expect(view.result.current).toBe(COLOR));
    expect(extractAccent).not.toHaveBeenCalled();
    expect(db.executeCount).toBe(0);
  });

  it("drops the previous album's tint while the next one is decoding", async () => {
    let resolveExtract: (color: string | null) => void = () => {};
    vi.mocked(extractAccent).mockImplementation(
      () => new Promise((resolve) => { resolveExtract = resolve; })
    );
    const view = renderHook(
      ({ id, accent }: { id: string; accent: string | null }) =>
        useAlbumAccent(id, accent, ART_URL, SERVER_ID),
      { wrapper, initialProps: { id: ALBUM_ID, accent: COLOR } as { id: string; accent: string | null } }
    );
    expect(view.result.current).toBe(COLOR);

    view.rerender({ id: "srv-a:alb2", accent: null });
    expect(view.result.current).toBeNull();

    resolveExtract("rgb(9, 9, 9)");
    await waitFor(() => expect(view.result.current).toBe("rgb(9, 9, 9)"));
  });

  it("leaves the album untinted when the cover cannot be decoded", async () => {
    vi.mocked(extractAccent).mockRejectedValue(new Error("decode failed"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderHook(
      () => useAlbumAccent(ALBUM_ID, null, ART_URL, SERVER_ID),
      { wrapper }
    );
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(view.result.current).toBeNull();
    expect(storedAccent()).toBeNull();
    errors.mockRestore();
  });

  it("does not decode anything when the album has no cover art", async () => {
    renderHook(() => useAlbumAccent(ALBUM_ID, null, null, SERVER_ID), { wrapper });
    await waitFor(() => expect(extractAccent).not.toHaveBeenCalled());
    expect(db.executeCount).toBe(0);
  });
});
