// @vitest-environment jsdom
/**
 * Baseline coverage for `src/hooks/useLoved.ts`'s read path, plus the harness regression it
 * exposed: `get_loved` had no default handler in the shared Tauri mock, so every suite that
 * mounted the hook without registering one ran the load through its `catch` and asserted
 * against sets that were empty because the read had failed. The success path is the default
 * here; the failure shape is asserted deliberately instead of incidentally.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { getDb } from "../db";
import { createMigratedTestDb } from "../test/sqlite";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { invokeCount } from "../test/perf";
import { useLovedSessionStore } from "../store/lovedSessionStore";
import { useLoved } from "./useLoved";

beforeEach(async () => {
  resetTauriMocks();
  vi.mocked(getDb).mockResolvedValue((await createMigratedTestDb()) as never);
  useLovedSessionStore.setState({ refreshTick: 0, sets: undefined, cachedTick: -1 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLoved read path", () => {
  it("loads an empty result without an error when no test registers get_loved", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useLoved());

    await waitFor(() => expect(useLovedSessionStore.getState().sets).toBeDefined());
    expect(result.current.lovedTrackIds.size).toBe(0);
    expect(useLovedSessionStore.getState().cachedTick).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it("puts the ids the command returns into the session sets", async () => {
    onInvoke("get_loved", () => ({
      trackIds: ["srv-a:t1", "srv-a:t2"],
      albumIds: ["srv-a:al1"],
      trackAlbumIds: ["srv-a:al2"],
    }));
    const { result } = renderHook(() => useLoved());

    await waitFor(() => expect(result.current.lovedTrackIds.size).toBe(2));
    expect(result.current.lovedTrackIds.has("srv-a:t1")).toBe(true);
    expect(result.current.lovedAlbumIds.has("srv-a:al1")).toBe(true);
    expect(result.current.lovedTrackAlbumIds.has("srv-a:al2")).toBe(true);
  });

  it("keeps the sets unset and reports the failure when the read throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    onInvoke("get_loved", () => {
      throw new Error("no such command");
    });
    const { result } = renderHook(() => useLoved());

    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(errors.mock.calls[0]?.[0]).toBe("useLoved: failed to load loved ids");
    expect(useLovedSessionStore.getState().sets).toBeUndefined();
    expect(result.current.lovedTrackIds.size).toBe(0);
  });

  it("reads once for many mounts on the same tick", async () => {
    onInvoke("get_loved", () => ({ trackIds: ["srv-a:t1"], albumIds: [], trackAlbumIds: [] }));
    const mounts = Array.from({ length: 8 }, () => renderHook(() => useLoved()));

    const last = mounts[mounts.length - 1]!;
    await waitFor(() => expect(last.result.current.lovedTrackIds.size).toBe(1));
    expect(invokeCount("get_loved")).toBe(1);
  });
});
