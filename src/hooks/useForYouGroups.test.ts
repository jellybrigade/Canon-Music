// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbumRow } from "../types/library";
import type { ForYouCategoryConfig } from "../lib/forYouGroups";

const setting = vi.hoisted(() => ({ value: "6", listeners: new Set<(v: string) => void>() }));

vi.mock("./useSetting", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useSetting: () => {
      const [value, setValue] = useState(setting.value);
      useEffect(() => {
        setting.listeners.add(setValue);
        return () => { setting.listeners.delete(setValue); };
      }, []);
      return [value, vi.fn(), true];
    },
  };
});

import { useForYouGroups } from "./useForYouGroups";

function albums(count: number): AlbumRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`, server_id: "s", name: `a${i}`, artist: null, year: null, artwork_url: `art${i}`,
  }));
}

const config: ForYouCategoryConfig[] = [{ key: "a", kicker: "A", enabled: true }];
const sources = { a: albums(30) };
const spotlightIds: string[] = [];

function publish(value: string) {
  setting.value = value;
  act(() => { for (const listener of setting.listeners) listener(value); });
}

describe("useForYouGroups", () => {
  beforeEach(() => { setting.value = "6"; });

  it("uses the saved per-tab count", () => {
    setting.value = "18";
    const { result } = renderHook(() => useForYouGroups(spotlightIds, sources, config, 1));
    expect(result.current.groups[0]!.albums.length).toBe(18);
    expect(result.current.perTab).toBe(18);
  });

  it("rebuilds the groups once per count change and never for a re-render with the same inputs", () => {
    const { result, rerender } = renderHook(() => useForYouGroups(spotlightIds, sources, config, 1));
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
});
