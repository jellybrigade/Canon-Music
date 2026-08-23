// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useNormalizeAlbum.ts`'s enrichment-counter bookkeeping.
 *
 * Regression pinned: known-issues "A per-mount claim on work keyed by an argument".
 * `AlbumDetail` has no `key`, so navigating A -> B -> A swaps `albumId` inside one mount.
 * A claim holding only the latest id lets the same album decrement the pending counter
 * twice, and the PlayerBar's "enriching" count then undercounts or clears early.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tag-normalize", () => ({
  readNormalizedTags: vi.fn().mockResolvedValue(null),
  normalizeAlbum: vi.fn().mockResolvedValue(undefined),
  isStale: vi.fn().mockReturnValue(true),
}));
vi.mock("./useAlbumIdentity", () => ({ useAlbumIdentity: vi.fn(() => ({ data: null })) }));
vi.mock("./useSetting", () => ({ useSetting: vi.fn(() => ["30"]) }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { normalizeAlbum } from "../lib/tag-normalize";
import { useTagsStore } from "../store/tags";
import { useNormalizeAlbum } from "./useNormalizeAlbum";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useTagsStore.setState({ enrichmentPending: 10 });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useNormalizeAlbum", () => {
  it("counts one album off the pending total once it is normalized", async () => {
    renderHook(() => useNormalizeAlbum("srv-a:alb-1", "slowdive", "Souvlaki"), { wrapper });

    await waitFor(() => expect(useTagsStore.getState().enrichmentPending).toBe(9));
    expect(vi.mocked(normalizeAlbum)).toHaveBeenCalledTimes(1);
  });

  it("counts each album once when the view returns to an album it already normalized", async () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useNormalizeAlbum(id, "slowdive", "Souvlaki"),
      { wrapper, initialProps: { id: "srv-a:alb-1" } }
    );

    await waitFor(() => expect(useTagsStore.getState().enrichmentPending).toBe(9));

    rerender({ id: "srv-a:alb-2" });
    await waitFor(() => expect(useTagsStore.getState().enrichmentPending).toBe(8));

    rerender({ id: "srv-a:alb-1" });
    await waitFor(() => expect(vi.mocked(normalizeAlbum)).toHaveBeenCalledTimes(3));

    expect(useTagsStore.getState().enrichmentPending).toBe(8);
  });
});
