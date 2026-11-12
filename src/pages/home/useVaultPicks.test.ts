// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbumStatRow } from "../../hooks/useListeningStats";

function stat(index: number, serverId = "s"): AlbumStatRow {
  return {
    id: `${serverId}:${index}`,
    server_id: serverId,
    name: `Album ${index}`,
    artist: null,
    year: null,
    artwork_url: `art${index}`,
    plays: 1,
    last_played: String(index).padStart(4, "0"),
  };
}

const oldestFirst = Array.from({ length: 150 }, (_, i) => stat(i));
const noHistory: AlbumStatRow[] = [];
const ids = (items: AlbumStatRow[]) => items.map((a) => a.id);

async function freshLaunch(random = 0.4) {
  vi.resetModules();
  vi.spyOn(Math, "random").mockReturnValue(random);
  return (await import("./useVaultPicks")).useVaultPicks;
}

describe("useVaultPicks", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shuffles instead of showing the oldest albums in order", async () => {
    const useVaultPicks = await freshLaunch(0);
    const { result } = renderHook(() => useVaultPicks(oldestFirst));
    expect(result.current.items).toHaveLength(20);
    expect(ids(result.current.items)).not.toEqual(ids(oldestFirst.slice(0, 20)));
  });

  it("keeps the same set across Home mounts and play-history changes", async () => {
    const useVaultPicks = await freshLaunch();
    const first = renderHook(() => useVaultPicks(oldestFirst));
    const picked = ids(first.result.current.items);
    first.unmount();
    const replayed = [...oldestFirst.slice(40), ...oldestFirst.slice(0, 40)];
    const second = renderHook(() => useVaultPicks(replayed));
    expect(ids(second.result.current.items)).toEqual(picked);
  });

  it("draws a new set per launch", async () => {
    const launchA = await freshLaunch(0.1);
    const a = ids(renderHook(() => launchA(oldestFirst)).result.current.items);
    const launchB = await freshLaunch(0.7);
    expect(ids(renderHook(() => launchB(oldestFirst)).result.current.items)).not.toEqual(a);
  });

  it("draws a new set on refresh and keeps it on the next mount", async () => {
    const useVaultPicks = await freshLaunch();
    const { result, unmount } = renderHook(() => useVaultPicks(oldestFirst));
    const before = ids(result.current.items);
    act(() => result.current.refresh());
    const refreshed = ids(result.current.items);
    expect(refreshed).not.toEqual(before);
    unmount();
    expect(ids(renderHook(() => useVaultPicks(oldestFirst)).result.current.items)).toEqual(refreshed);
  });

  it("waits for play history, keeps the picks while it reloads, and picks afresh for another server", async () => {
    const useVaultPicks = await freshLaunch();
    const { result, rerender } = renderHook((props: { rows: AlbumStatRow[] }) => useVaultPicks(props.rows), {
      initialProps: { rows: noHistory },
    });
    expect(result.current.items).toEqual([]);
    rerender({ rows: oldestFirst });
    expect(result.current.items).toHaveLength(20);
    const picked = ids(result.current.items);
    rerender({ rows: noHistory });
    rerender({ rows: [...oldestFirst].reverse() });
    expect(ids(result.current.items)).toEqual(picked);
    rerender({ rows: Array.from({ length: 150 }, (_, i) => stat(i, "t")) });
    expect(result.current.items.every((a) => a.server_id === "t")).toBe(true);
  });

  it("only picks from the 100 least recently played", async () => {
    for (const value of [0, 0.3, 0.99]) {
      const useVaultPicks = await freshLaunch(value);
      const { result } = renderHook(() => useVaultPicks(oldestFirst));
      expect(result.current.items.every((a) => Number(a.id.split(":")[1]) < 100)).toBe(true);
    }
  });
});
