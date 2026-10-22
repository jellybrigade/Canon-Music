// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDevicePixelRatio } from "./useDevicePixelRatio";

type Listener = () => void;

function stubScreen(initialRatio: number) {
  const listeners = new Map<string, Set<Listener>>();
  vi.stubGlobal("devicePixelRatio", initialRatio);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: true,
      addEventListener: (_: string, listener: Listener) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)?.add(listener);
      },
      removeEventListener: (_: string, listener: Listener) => listeners.get(query)?.delete(listener),
    })),
  );
  return {
    moveTo(ratio: number) {
      const watching = [...listeners.values()].flatMap((set) => [...set]);
      vi.stubGlobal("devicePixelRatio", ratio);
      for (const listener of watching) listener();
    },
    armedCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useDevicePixelRatio", () => {
  it("follows the window onto a screen with another pixel ratio", () => {
    const screen = stubScreen(1);
    const { result } = renderHook(() => useDevicePixelRatio());
    expect(result.current).toBe(1);

    act(() => screen.moveTo(2));
    expect(result.current).toBe(2);
    expect(screen.armedCount()).toBe(1);
  });

  it("stops watching on unmount", () => {
    const screen = stubScreen(1);
    const { unmount } = renderHook(() => useDevicePixelRatio());
    unmount();
    expect(screen.armedCount()).toBe(0);
  });
});
