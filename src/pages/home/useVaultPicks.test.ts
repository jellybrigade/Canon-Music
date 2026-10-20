// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVaultPicks } from "./useVaultPicks";

const oldestFirst = Array.from({ length: 150 }, (_, i) => i);

describe("useVaultPicks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shuffles on the first mount instead of showing the oldest albums in order", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result } = renderHook(() => useVaultPicks(oldestFirst));
    expect(result.current.items).toHaveLength(20);
    expect(result.current.items).not.toEqual(oldestFirst.slice(0, 20));
  });

  it("draws a new set each time Home mounts", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValue(0.1);
    const first = renderHook(() => useVaultPicks(oldestFirst)).result.current.items;
    random.mockReturnValue(0.7);
    const second = renderHook(() => useVaultPicks(oldestFirst)).result.current.items;
    expect(second).not.toEqual(first);
  });

  it("draws a new set on refresh and keeps it across re-renders", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    const { result, rerender } = renderHook(() => useVaultPicks(oldestFirst));
    const before = result.current.items;
    act(() => result.current.refresh());
    const refreshed = result.current.items;
    expect(refreshed).not.toEqual(before);
    rerender();
    expect(result.current.items).toBe(refreshed);
  });

  it("only picks from the 100 least recently played", () => {
    for (const value of [0, 0.3, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(value);
      const { result } = renderHook(() => useVaultPicks(oldestFirst));
      expect(result.current.items.every((n) => n < 100)).toBe(true);
    }
  });
});
