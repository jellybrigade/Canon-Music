// @vitest-environment jsdom
/**
 * Coverage for `src/features/tags/hooks/useNormalizeAlbum.ts`'s enrichment-counter bookkeeping.
 *
 * Regression pinned: known-issues "A per-mount claim on work keyed by an argument".
 * `AlbumDetail` has no `key`, so navigating A -> B -> A swaps `albumId` inside one mount.
 * A claim holding only the latest id lets the same album decrement the pending counter
 * twice, and the PlayerBar's "enriching" count then undercounts or clears early.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tagNormalize", () => ({
  readNormalizedTags: vi.fn().mockResolvedValue(null),
  normalizeAlbum: vi.fn().mockResolvedValue(undefined),
  isStale: vi.fn().mockReturnValue(true),
}));
vi.mock("../../enrichment/hooks/useAlbumIdentity", () => ({ useAlbumIdentity: vi.fn(() => ({ data: null })) }));
const stalenessSetting = vi.hoisted(() => ({ isLoaded: true }));
vi.mock("../../../hooks/useSetting", () => ({
  useSetting: () => ["30", async () => {}, stalenessSetting.isLoaded],
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QK } from "../../../lib/queryKeys";
import { normalizeAlbum } from "../lib/tagNormalize";
import { useTagsStore } from "../store/tags";
import { useNormalizeAlbum } from "./useNormalizeAlbum";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stalenessSetting.isLoaded = true;
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

  it("waits for the staleness setting to be read back before normalizing", async () => {
    stalenessSetting.isLoaded = false;
    const { rerender } = renderHook(() => useNormalizeAlbum("srv-a:alb-1", "slowdive", "Souvlaki"), { wrapper });
    await waitFor(() => expect(queryClient.getQueryState(QK.normalizedTags("srv-a:alb-1"))?.status).toBe("success"));
    rerender();
    expect(vi.mocked(normalizeAlbum)).not.toHaveBeenCalled();

    stalenessSetting.isLoaded = true;
    rerender();
    await waitFor(() => expect(vi.mocked(normalizeAlbum)).toHaveBeenCalledTimes(1));
  });

  it("counts each album once when the view returns to an album it already normalized", async () => {
    const { rerender } = renderHook(({ id }: { id: string }) => useNormalizeAlbum(id, "slowdive", "Souvlaki"), {
      wrapper,
      initialProps: { id: "srv-a:alb-1" },
    });

    await waitFor(() => expect(useTagsStore.getState().enrichmentPending).toBe(9));

    rerender({ id: "srv-a:alb-2" });
    await waitFor(() => expect(useTagsStore.getState().enrichmentPending).toBe(8));

    rerender({ id: "srv-a:alb-1" });
    await waitFor(() => expect(vi.mocked(normalizeAlbum)).toHaveBeenCalledTimes(3));

    expect(useTagsStore.getState().enrichmentPending).toBe(8);
  });
});
