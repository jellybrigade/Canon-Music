// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useGenreDisplay.ts`.
 *
 * The canon tree is read through an un-abortable promise, so the unmount case cannot be
 * asserted through rendered output: React 18 no-ops a state write on a dead hook without
 * warning, and an unmounted tree renders nothing either way. The witness is instead the
 * work the settle handler does - `tree.nodes` is a counting getter, so a handler that
 * runs after unmount is visible as a read that a guarded handler never performs.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/canonicalize", () => ({ getCanonTree: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { getCanonTree } from "../lib/canonicalize";
import type { CanonTree, TreeNode } from "../lib/canonicalize";
import { useGenreMappings, applyGenreMappings } from "./useGenreDisplay";

const SHOEGAZE: TreeNode = {
  id: "shoegaze",
  name: "Shoegaze",
  type: "genre",
  canonical_key: "shoegaze",
  parents: [],
};

let queryClient: QueryClient;
let mappingRows: { raw_value: string; canonical_id: string }[];

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

/** A tree whose `nodes` read is counted, so post-unmount work has a witness. */
function countingTree(nodes: TreeNode[]) {
  let reads = 0;
  const tree = {
    get nodes() {
      reads += 1;
      return nodes;
    },
    byKey: new Map(nodes.map((n) => [n.canonical_key, n])),
    byId: new Map(nodes.map((n) => [n.id, n])),
  } as unknown as CanonTree;
  return { tree, readCount: () => reads };
}

/** Holds `getCanonTree` open until the returned `resolve` is called. */
function deferredTree(tree: CanonTree) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.mocked(getCanonTree).mockImplementation(() => gate.then(() => tree));
  return async () => {
    release();
    await gate;
    await Promise.resolve();
  };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mappingRows = [];
  vi.mocked(getDb).mockResolvedValue({
    select: vi.fn(async () => mappingRows),
  } as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(getCanonTree).mockResolvedValue(countingTree([SHOEGAZE]).tree);
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

    await waitFor(() => expect(result.current.get("shoe gaze")).toBe("Shoegaze"));
  });

  it("falls back to the raw value when the canonical id is not in the tree", async () => {
    mappingRows = [{ raw_value: "vaporwave", canonical_id: "not-a-node" }];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current.get("vaporwave")).toBe("vaporwave"));
  });

  it("maps an ignored raw value to null and an accepted one to itself", async () => {
    mappingRows = [
      { raw_value: "misc", canonical_id: "__ignored__" },
      { raw_value: "Dream Pop", canonical_id: "__accepted__" },
    ];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("misc")).toBeNull();
    expect(result.current.get("Dream Pop")).toBe("Dream Pop");
  });

  it("does no tree work after unmount", async () => {
    const { tree, readCount } = countingTree([SHOEGAZE]);
    const resolveTree = deferredTree(tree);

    const { unmount } = renderHook(() => useGenreMappings(), { wrapper });
    unmount();
    await resolveTree();

    expect(readCount()).toBe(0);
  });

  it("still reads the tree when the hook is alive when it settles", async () => {
    const { tree, readCount } = countingTree([SHOEGAZE]);
    const resolveTree = deferredTree(tree);
    mappingRows = [{ raw_value: "shoe gaze", canonical_id: "shoegaze" }];

    const { result } = renderHook(() => useGenreMappings(), { wrapper });
    await resolveTree();

    await waitFor(() => expect(result.current.get("shoe gaze")).toBe("Shoegaze"));
    expect(readCount()).toBe(1);
  });
});

describe("applyGenreMappings", () => {
  it("returns nothing for a null or empty raw string", () => {
    expect(applyGenreMappings(null, new Map())).toEqual([]);
    expect(applyGenreMappings("", new Map())).toEqual([]);
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
