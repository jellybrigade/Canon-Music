// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { QK } from "../lib/queryKeys";
import { useAlbumCoverMap } from "./useCoverCache";

let db: FakeDatabase;
let queryClient: QueryClient;
let objectUrlCounter = 0;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

async function seedCover(albumId: string, bytes: string): Promise<void> {
  await db.execute(
    "INSERT INTO album_covers (album_id, data_url, cached_at) VALUES (?, ?, ?)",
    [albumId, `data:image/jpeg;base64,${bytes}`, 0],
  );
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
