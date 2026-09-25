// @vitest-environment jsdom
/**
 * Home's rails unmount whenever the user leaves Home. React Query's default 5 min gcTime then
 * drops their data, so coming back after a longer detour showed skeletons and refetched every
 * rail. These pin that an unobserved Home query survives well past 5 min.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../clients/navidrome", () => ({ fetchAlbumListByType: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchAlbumListByType } from "../clients/navidrome";
import { QK } from "../lib/queryKeys";
import { HOME_GC_TIME } from "../lib/homeQueryTiming";
import { useListeningStats } from "./useListeningStats";
import { useCarouselAlbums } from "./useCarouselAlbums";
import { useRecentlyReleasedAlbums } from "./useRecentlyReleasedAlbums";
import { useRecommendedAlbum } from "./useRecommendedAlbum";
import type { ServerWithCredential } from "./useServer";

const DEFAULT_GC_TIME = 5 * 60 * 1000;

const SERVER = {
  server: { id: "srv-a", url: "http://navidrome", username: "u", alt_url: null },
  credential: "secret",
} as unknown as ServerWithCredential;

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.mocked(getDb).mockResolvedValue({
    select: vi.fn().mockResolvedValue([]),
  } as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(fetchAlbumListByType).mockResolvedValue([]);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  queryClient.clear();
  vi.clearAllMocks();
});

const cases: { name: string; key: readonly unknown[]; mount: () => unknown }[] = [
  { name: "listening stats", key: QK.albumsListeningStats(), mount: () => useListeningStats() },
  { name: "partially heard", key: QK.albumsPartiallyHeard(), mount: () => useListeningStats() },
  {
    name: "carousel",
    key: QK.carousel("recent", "srv-a"),
    mount: () => useCarouselAlbums(SERVER, "recent"),
  },
  { name: "recently released", key: QK.recentlyReleased(20), mount: () => useRecentlyReleasedAlbums() },
  {
    name: "recommended spotlight",
    key: QK.recommendedSpotlight("srv-a:alb1"),
    mount: () => useRecommendedAlbum("srv-a:alb1"),
  },
];

describe("Home queries after leaving Home", () => {
  it.each(cases)("$name stays cached past the default gcTime", async ({ key, mount }) => {
    const { unmount } = renderHook(mount, { wrapper });
    await waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe("success"));

    vi.useFakeTimers();
    unmount();
    vi.advanceTimersByTime(DEFAULT_GC_TIME + 60_000);
    expect(queryClient.getQueryData(key)).toBeDefined();

    vi.advanceTimersByTime(HOME_GC_TIME);
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});
