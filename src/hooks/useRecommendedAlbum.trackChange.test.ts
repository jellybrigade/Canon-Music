// @vitest-environment jsdom
/**
 * The recommendation is keyed by the playing album, so every album change starts a fresh query.
 * Without the previous pick held through that fetch, Home's spotlight fell back to a carousel pick
 * and then swapped again to the new recommendation: two remounts per track change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { useRecommendedAlbum } from "./useRecommendedAlbum";

const row = (id: string) => ({
  id,
  server_id: "srv-a",
  name: id,
  artist: null,
  year: null,
  artwork_url: "http://art",
  accent_color: null,
});

let queryClient: QueryClient;
let resolveSecond: (rows: unknown[]) => void;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  const select = vi
    .fn()
    .mockResolvedValueOnce([row("srv-a:rec1")])
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  vi.mocked(getDb).mockResolvedValue({ select } as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useRecommendedAlbum on album change", () => {
  it("holds the previous pick until the new one resolves", async () => {
    const seen: (string | undefined)[] = [];
    const { rerender } = renderHook(
      ({ albumId }: { albumId: string }) => {
        const { data } = useRecommendedAlbum(albumId);
        seen.push(data?.id);
        return data;
      },
      { wrapper, initialProps: { albumId: "srv-a:alb1" } },
    );
    await waitFor(() => expect(seen[seen.length - 1]).toBe("srv-a:rec1"));
    const settledAt = seen.length - 1;

    rerender({ albumId: "srv-a:alb2" });
    await waitFor(() => expect(vi.mocked(getDb)).toHaveBeenCalledTimes(2));
    resolveSecond([row("srv-a:rec2")]);
    await waitFor(() => expect(seen[seen.length - 1]).toBe("srv-a:rec2"));

    const afterSettle = seen.slice(settledAt);
    expect(afterSettle).not.toContain(undefined);
    expect(new Set(afterSettle)).toEqual(new Set(["srv-a:rec1", "srv-a:rec2"]));
  });
});
