// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/canonicalize", () => ({ getCanonTree: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QK } from "../../../lib/queryKeys";
import type { CanonTree, TreeNode } from "../lib/canonicalize";
import { getCanonTree } from "../lib/canonicalize";
import { useCanonTreeNodes } from "./useCanonTreeNodes";

const JAZZ: TreeNode = { id: "jazz", name: "Jazz", type: "genre", canonical_key: "jazz", parents: [], sections: [] };

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useCanonTreeNodes", () => {
  it("reports a failed tree read instead of an empty tree", async () => {
    vi.mocked(getCanonTree).mockRejectedValue(new Error("database is locked"));

    const { result } = renderHook(() => useCanonTreeNodes(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("reads the tree again when user nodes are refreshed", async () => {
    vi.mocked(getCanonTree).mockResolvedValue({ nodes: [JAZZ] } as CanonTree);
    const { result } = renderHook(() => useCanonTreeNodes(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([JAZZ]));

    await act(() => queryClient.invalidateQueries({ queryKey: QK.userTreeNodes() }));

    expect(getCanonTree).toHaveBeenCalledTimes(2);
  });
});
