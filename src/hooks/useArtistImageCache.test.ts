// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { QK } from "../lib/queryKeys";
import { useArtistImageMap } from "./useArtistImageCache";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
});

describe("useArtistImageMap", () => {
  it("keeps a loaded portrait across a keyset invalidation instead of blanking it", async () => {
    const dataUrl = "data:image/jpeg;base64,AAAA";
    await db.execute(
      "INSERT INTO artist_covers (artist_name, data_url, cached_at) VALUES (?, ?, ?)",
      ["Slowdive", dataUrl, 0],
    );
    const { result } = renderHook(() => useArtistImageMap(), { wrapper });
    await waitFor(() => expect(result.current.get("Slowdive")).toBe(dataUrl));
    const portraitReads = () =>
      db.queryLog.filter((q) => q.kind === "select" && q.sql.includes("data_url")).length;
    const readsBefore = portraitReads();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: QK.artistCovers() });
    });

    expect(result.current.get("Slowdive")).toBe(dataUrl);
    expect(portraitReads()).toBe(readsBefore);
  });
});
