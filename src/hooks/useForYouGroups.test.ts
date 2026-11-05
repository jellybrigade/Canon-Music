// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForYouCategoryConfig } from "../lib/forYouGroups";
import type { AlbumRow } from "../types/library";

const settings = vi.hoisted(() => ({
  values: new Map<string, string>(),
  listeners: new Set<() => void>(),
}));

vi.mock("./useSetting", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useSetting: (key: string, defaultValue: string) => {
      const [, setVersion] = useState(0);
      useEffect(() => {
        const listener = () => setVersion((v) => v + 1);
        settings.listeners.add(listener);
        return () => {
          settings.listeners.delete(listener);
        };
      }, []);
      const store = async (value: string) => {
        settings.values.set(key, value);
        for (const listener of settings.listeners) listener();
      };
      return [settings.values.get(key) ?? defaultValue, store, true];
    },
  };
});

import { useForYouGroups } from "./useForYouGroups";

function albums(count: number): AlbumRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    server_id: "s",
    name: `a${i}`,
    artist: null,
    year: null,
    artwork_url: `art${i}`,
  }));
}

const config: ForYouCategoryConfig[] = [{ key: "a", kicker: "A", enabled: true }];
const sources = { a: albums(30) };
const spotlightIds: string[] = [];
const ids = (groups: { albums: AlbumRow[] }[]) => groups.map((g) => g.albums.map((a) => a.id));

function publish(value: string) {
  act(() => {
    settings.values.set("for_you_per_tab", value);
    for (const listener of settings.listeners) listener();
  });
}

const base = { spotlightIds, config, serverId: "s", isReady: true };

describe("useForYouGroups", () => {
  beforeEach(() => {
    settings.values.clear();
  });

  it("uses the saved per-tab count", () => {
    settings.values.set("for_you_per_tab", "18");
    const { result } = renderHook(() => useForYouGroups({ ...base, sources, seed: 1 }));
    expect(result.current.groups[0]!.albums.length).toBe(18);
    expect(result.current.perTab).toBe(18);
  });

  it("rebuilds the groups once per count change and never for a re-render with the same inputs", () => {
    const { result, rerender } = renderHook(() => useForYouGroups({ ...base, sources, seed: 1 }));
    const seen = new Set([result.current.groups]);

    for (let i = 0; i < 5; i++) rerender();
    seen.add(result.current.groups);
    expect(seen.size).toBe(1);

    publish("12");
    seen.add(result.current.groups);
    publish("12");
    seen.add(result.current.groups);
    expect(seen.size).toBe(2);
    expect(result.current.groups[0]!.albums.length).toBe(12);
  });

  it("keeps the picks through source, spotlight and remount changes, and re-picks only for a new seed", () => {
    type Props = { sources: Record<string, AlbumRow[]>; spotlightIds: string[]; seed: number };
    const render = (initial: Props) =>
      renderHook((p: Props) => useForYouGroups({ ...base, ...p }), { initialProps: initial });
    const first = render({ sources, spotlightIds, seed: 41 });
    const picked = ids(first.result.current.groups);

    first.rerender({ sources: { a: [...albums(40)].reverse() }, spotlightIds: [picked[0]![0]!], seed: 41 });
    expect(ids(first.result.current.groups)).toEqual(picked);
    first.unmount();

    const again = render({ sources: { a: albums(50).slice(3) }, spotlightIds: ["a9"], seed: 41 });
    expect(ids(again.result.current.groups)).toEqual(picked);

    again.rerender({ sources, spotlightIds, seed: 42 });
    expect(ids(again.result.current.groups)).not.toEqual(picked);
  });

  it("waits for its sources to finish loading before picking", () => {
    const { result, rerender } = renderHook(
      ({ isReady, partial }: { isReady: boolean; partial: AlbumRow[] }) =>
        useForYouGroups({ ...base, sources: { a: partial }, seed: 77, isReady }),
      { initialProps: { isReady: false, partial: albums(2) } },
    );
    expect(result.current.groups).toEqual([]);
    rerender({ isReady: true, partial: albums(30) });
    expect(result.current.groups[0]!.albums).toHaveLength(6);
  });

  it("keeps a locked tab through a new seed and a remount, and an unlocked one shows the same until the next seed", () => {
    const twoTabs: ForYouCategoryConfig[] = [...config, { key: "b", kicker: "B", enabled: true }];
    const both = { a: albums(30), b: albums(30).map((a) => ({ ...a, id: `b${a.id}` })) };
    const tab = (groups: { key: string; albums: AlbumRow[] }[], key: string) =>
      groups.find((g) => g.key === key)!.albums.map((a) => a.id);
    const { result, rerender, unmount } = renderHook(
      ({ seed }: { seed: number }) => useForYouGroups({ ...base, config: twoTabs, sources: both, seed }),
      { initialProps: { seed: 90 } },
    );
    const lockedB = tab(result.current.groups, "b");
    const firstA = tab(result.current.groups, "a");
    act(() => result.current.toggleLock("b"));
    expect(result.current.groups.find((g) => g.key === "b")!.isLocked).toBe(true);

    rerender({ seed: 91 });
    expect(tab(result.current.groups, "b")).toEqual(lockedB);
    expect(tab(result.current.groups, "a")).not.toEqual(firstA);
    unmount();

    const again = renderHook(() => useForYouGroups({ ...base, config: twoTabs, sources: both, seed: 92 }));
    expect(tab(again.result.current.groups, "b")).toEqual(lockedB);
    act(() => again.result.current.toggleLock("b"));
    expect(again.result.current.groups.find((g) => g.key === "b")!.isLocked).toBe(false);
    expect(tab(again.result.current.groups, "b")).toEqual(lockedB);
  });

  it("picks afresh for another server under the same seed", () => {
    const { result, rerender } = renderHook(
      ({ serverId, sources: current }: { serverId: string; sources: Record<string, AlbumRow[]> }) =>
        useForYouGroups({ ...base, serverId, sources: current, seed: 120 }),
      { initialProps: { serverId: "s", sources } },
    );
    const other = { a: albums(30).map((a) => ({ ...a, id: `t:${a.id}`, server_id: "t" })) };
    rerender({ serverId: "t", sources: other });
    expect(result.current.groups[0]!.albums.every((a) => a.server_id === "t")).toBe(true);
  });
});
