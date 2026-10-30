// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../clients/boundedFetch", () => ({ boundedFetch: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { boundedFetch } from "../clients/boundedFetch";
import { getDb } from "../db";
import { QK } from "../lib/queryKeys";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { refreshAlbumCover, useAlbumCoverMap } from "./useCoverCache";
import type { ServerWithCredential } from "./useServer";

let db: FakeDatabase;
let queryClient: QueryClient;
let objectUrlCounter = 0;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

async function seedCover(albumId: string, bytes: string): Promise<void> {
  await db.execute("INSERT INTO album_covers (album_id, data_url, cached_at) VALUES (?, ?, ?)", [
    albumId,
    `data:image/jpeg;base64,${bytes}`,
    0,
  ]);
}

function coverReads(): number {
  return db.queryLog.filter((q) => q.kind === "select" && q.sql.includes("data_url")).length;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  URL.createObjectURL = vi.fn(() => `blob:test-${++objectUrlCounter}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

async function loadCover(albumId: string) {
  const hook = renderHook(() => useAlbumCoverMap(), { wrapper });
  await waitFor(() => expect(hook.result.current.get(albumId)).toBeUndefined());
  await waitFor(() => expect(hook.result.current.get(albumId)).toMatch(/^blob:/));
  return hook;
}

async function invalidateKeyset(): Promise<void> {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: QK.albumCovers() });
  });
}

describe("useAlbumCoverMap", () => {
  it("keeps a loaded cover across a keyset invalidation instead of blanking it", async () => {
    await seedCover("keep-1", "AAAA");
    const { result } = await loadCover("keep-1");
    const loadedUrl = result.current.get("keep-1");
    const readsBefore = coverReads();

    await invalidateKeyset();

    expect(result.current.get("keep-1")).toBe(loadedUrl);
    await act(async () => {
      await Promise.resolve();
    });
    expect(coverReads()).toBe(readsBefore);
  });

  it("drops a cover whose row was pruned when the keyset refreshes", async () => {
    await seedCover("pruned-1", "BBBB");
    const { result } = await loadCover("pruned-1");

    await db.execute("DELETE FROM album_covers WHERE album_id = ?", ["pruned-1"]);
    await invalidateKeyset();

    expect(result.current.get("pruned-1")).toBeUndefined();
  });
});

describe("refreshAlbumCover", () => {
  const swc = {
    server: { id: "srv", url: "http://music.example", username: "alice" },
    credential: { type: "md5", token: "t", salt: "s" },
  } as ServerWithCredential;

  async function storedDataUrl(albumId: string): Promise<string | undefined> {
    const rows = await db.select<{ data_url: string }[]>("SELECT data_url FROM album_covers WHERE album_id = ?", [
      albumId,
    ]);
    return rows[0]?.data_url;
  }

  it("replaces a loaded cover with the newly served one", async () => {
    await seedCover("swap-1", "AAAA");
    const { result } = await loadCover("swap-1");
    const before = result.current.get("swap-1");
    // jsdom's FileReader reads only jsdom's own Blob, not the one Node's Response hands back.
    vi.mocked(boundedFetch).mockImplementation(
      async () => ({ ok: true, blob: async () => new Blob(["new"], { type: "image/png" }) }) as Response,
    );

    await act(async () => {
      expect(await refreshAlbumCover(queryClient, { albumId: "swap-1", artworkUrl: "al-swap_1", swc })).toBe(true);
    });

    expect(await storedDataUrl("swap-1")).toMatch(/^data:image\/png;base64,/);
    await waitFor(() => expect(result.current.get("swap-1")).not.toBe(before));
  });

  it("forgets the old cover when the new one cannot be read, so the grid asks the server URL", async () => {
    await seedCover("fail-1", "CCCC");
    const { result } = await loadCover("fail-1");
    vi.mocked(boundedFetch).mockImplementation(async () => new Response("", { status: 502 }));

    await act(async () => {
      expect(await refreshAlbumCover(queryClient, { albumId: "fail-1", artworkUrl: "al-fail_1", swc })).toBe(false);
    });

    expect(await storedDataUrl("fail-1")).toBeUndefined();
    await waitFor(() => expect(result.current.get("fail-1")).toBeUndefined());
  });
});
