// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../features/tags/lib/canonicalize", () => ({ getCanonTree: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../db";
import type { CanonTree, TreeNode } from "../features/tags/lib/canonicalize";
import { getCanonTree } from "../features/tags/lib/canonicalize";
import { applyGenreMappings, useGenreMappings } from "./useGenreDisplay";

const SHOEGAZE: TreeNode = {
  id: "shoegaze",
  name: "Shoegaze",
  type: "genre",
  canonical_key: "shoegaze",
  parents: [],
  sections: ["genres"],
};

let queryClient: QueryClient;
let mappingRows: { raw_value: string; canonical_id: string }[];

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mappingRows = [];
  vi.mocked(getDb).mockResolvedValue({
    select: vi.fn(async () => mappingRows),
  } as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(getCanonTree).mockResolvedValue({ nodes: [SHOEGAZE] } as CanonTree);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useGenreMappings", () => {
  it("resolves a mapped raw value to its canon tree display name", async () => {
    mappingRows = [{ raw_value: "shoe gaze", canonical_id: "shoegaze" }];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current?.get("shoe gaze")).toBe("Shoegaze"));
  });

  it("falls back to the raw value when the canonical id is not in the tree", async () => {
    mappingRows = [{ raw_value: "vaporwave", canonical_id: "not-a-node" }];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current?.get("vaporwave")).toBe("vaporwave"));
  });

  it("maps an ignored raw value to null and an accepted one to itself", async () => {
    mappingRows = [
      { raw_value: "misc", canonical_id: "__ignored__" },
      { raw_value: "Dream Pop", canonical_id: "__accepted__" },
    ];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current?.size).toBe(2));
    expect(result.current?.get("misc")).toBeNull();
    expect(result.current?.get("Dream Pop")).toBe("Dream Pop");
  });

  it("reports a failed mapping read as null rather than an empty map", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn(async () => {
        throw new Error("database is locked");
      }),
    } as unknown as Awaited<ReturnType<typeof getDb>>);

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("keeps the raw value as the name when the tree read fails", async () => {
    vi.mocked(getCanonTree).mockRejectedValue(new Error("database is locked"));
    mappingRows = [{ raw_value: "shoe gaze", canonical_id: "shoegaze" }];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current?.get("shoe gaze")).toBe("shoe gaze"));
  });
});

describe("applyGenreMappings", () => {
  it("returns nothing for a null or empty raw string", () => {
    expect(applyGenreMappings(null, new Map())).toEqual([]);
    expect(applyGenreMappings("", new Map())).toEqual([]);
  });

  it("shows the raw values when the mappings could not be read", () => {
    expect(applyGenreMappings("shoe gaze; misc, shoe gaze", null)).toEqual(["shoe gaze", "misc"]);
  });

  it("drops raw values with no mapping decision", () => {
    const mappings = new Map<string, string | null>([["shoe gaze", "Shoegaze"]]);

    expect(applyGenreMappings("shoe gaze, unreviewed", mappings)).toEqual(["Shoegaze"]);
  });

  it("drops ignored values and de-dupes on the display name", () => {
    const mappings = new Map<string, string | null>([
      ["shoe gaze", "Shoegaze"],
      ["shoegaze", "Shoegaze"],
      ["misc", null],
    ]);

    expect(applyGenreMappings("shoe gaze; misc; shoegaze", mappings)).toEqual(["Shoegaze"]);
  });
});
