// @vitest-environment jsdom
/**
 * Coverage for the delete path of `src/features/tags/hooks/useUserTree.ts`.
 *
 * Regression pinned (known-issues.md, "Transaction real only if statements share a
 * connection"): the four statements this delete runs pass through states the app cannot be
 * started in (a node nothing maps to, then tags pointing at a node that is gone), and
 * tauri-plugin-sql's pool makes a TS `BEGIN` a no-op. The SQL itself now lives in the
 * `delete_user_tree_node` Rust command, where `src-tauri/src/library_write/user_tree.rs` owns its
 * table-state and rollback coverage. What is asserted here is the hook's half: the command is
 * invoked once with the node, the hook writes no SQL of its own, and a rejection reaches the
 * caller instead of leaving the caches claiming the node is gone.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { invoke, onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { useDeleteUserNode } from "./useUserTree";

let db: FakeDatabase;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(async () => {
  resetTauriMocks();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  db.raw
    .prepare("INSERT INTO user_tree_nodes (id, name, type, canonical_key, parent_ids) VALUES (?, ?, ?, ?, ?)")
    .run("user:doom", "Doom Jazz", "genre", "doom jazz", '["jazz"]');
});

afterEach(async () => {
  cleanup();
  await db.close();
});

describe("useDeleteUserNode", () => {
  it("hands the whole delete to one command", async () => {
    const { result } = renderHook(() => useDeleteUserNode(), { wrapper });
    const before = db.executeCount;

    await act(async () => {
      await result.current.mutateAsync({ id: "user:doom", name: "Doom Jazz" });
    });

    const calls = invoke.mock.calls.filter(([cmd]) => cmd === "delete_user_tree_node");
    expect(calls).toEqual([["delete_user_tree_node", { id: "user:doom", name: "Doom Jazz" }]]);
    expect(db.executeCount).toBe(before);
  });

  it("reports a rejected delete instead of reporting success", async () => {
    onInvoke("delete_user_tree_node", () => {
      throw new Error("Node not found.");
    });
    const { result } = renderHook(() => useDeleteUserNode(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: "user:gone", name: "Gone" })
      ).rejects.toThrow("Node not found.");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
