// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_SET_WAIT_MS, useHeldCoverSet } from "./useHeldCoverSet";

const preloads = vi.hoisted(() => {
  const pending = new Map<string, { resolve: () => void; reject: () => void }>();
  return {
    pending,
    preloadImage: vi.fn(
      (url: string) =>
        new Promise<void>((resolve, reject) => {
          pending.set(url, { resolve, reject });
        }),
    ),
  };
});

vi.mock("../lib/preloadImage", () => ({ preloadImage: preloads.preloadImage }));

interface Item {
  id: string;
  cover: string | null;
  name?: string;
}

const coverOf = (item: Item) => item.cover;
const A = { id: "a", cover: "cover://a" };
const B = { id: "b", cover: "cover://b" };
const C = { id: "c", cover: "cover://c" };
const D = { id: "d", cover: null };

function renderSet(initial: Item[]) {
  return renderHook(({ items }) => useHeldCoverSet(items, coverOf), { initialProps: { items: initial } });
}

async function settle(url: string, outcome: "resolve" | "reject" = "resolve") {
  await act(async () => {
    preloads.pending.get(url)?.[outcome]();
  });
}

beforeEach(() => {
  preloads.pending.clear();
  preloads.preloadImage.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useHeldCoverSet", () => {
  it("shows the first set at once", () => {
    const { result } = renderSet([A]);
    expect(result.current).toEqual([A]);
    expect(preloads.preloadImage).toHaveBeenCalledTimes(0);
  });

  it("keeps the shown set until every new cover has loaded", async () => {
    const { result, rerender } = renderSet([A]);
    rerender({ items: [B, C, D] });
    expect(result.current).toEqual([A]);
    expect(preloads.preloadImage.mock.calls.map(([url]) => url)).toEqual(["cover://b", "cover://c"]);

    await settle("cover://b");
    expect(result.current).toEqual([A]);

    await settle("cover://c", "reject");
    expect(result.current).toEqual([B, C, D]);
  });

  it("swaps anyway once the covers are slow to arrive", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderSet([A]);
    rerender({ items: [B] });

    act(() => vi.advanceTimersByTime(COVER_SET_WAIT_MS - 1));
    expect(result.current).toEqual([A]);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual([B]);
  });

  it("preloads the cover a card will show when it changes mid-wait, and swaps once that loads", async () => {
    const { result, rerender } = renderSet([A]);
    rerender({ items: [B] });
    const cached = { ...B, cover: "blob:b" };
    rerender({ items: [cached] });
    expect(preloads.preloadImage.mock.calls.map(([url]) => url)).toEqual(["cover://b", "blob:b"]);

    await settle("cover://b");
    expect(result.current).toEqual([A]);

    await settle("blob:b");
    expect(result.current).toEqual([cached]);
  });

  it("keeps its first deadline when a cover changes mid-wait", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderSet([A]);
    rerender({ items: [B] });
    act(() => vi.advanceTimersByTime(COVER_SET_WAIT_MS - 100));
    rerender({ items: [{ ...B, cover: "blob:b" }] });

    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toEqual([{ ...B, cover: "blob:b" }]);
  });

  it("passes fresh data for the same albums straight through", () => {
    const { result, rerender } = renderSet([A]);
    const renamed = { ...A, name: "Renamed" };
    rerender({ items: [renamed] });
    expect(result.current).toEqual([renamed]);
    expect(preloads.preloadImage).toHaveBeenCalledTimes(0);
  });

  it("swaps at once from an empty set", () => {
    const { result, rerender } = renderSet([]);
    rerender({ items: [B] });
    expect(result.current).toEqual([B]);
    expect(preloads.preloadImage).toHaveBeenCalledTimes(0);
  });

  it("lands on the latest set when asked again mid-swap", async () => {
    const { result, rerender } = renderSet([A]);
    rerender({ items: [B] });
    rerender({ items: [C] });

    await settle("cover://b");
    expect(result.current).toEqual([A]);

    await settle("cover://c");
    expect(result.current).toEqual([C]);
  });

  it("returns to the shown set without a swap when asked mid-swap", async () => {
    const { result, rerender } = renderSet([A]);
    rerender({ items: [B] });
    rerender({ items: [A] });

    await settle("cover://b");
    expect(result.current).toEqual([A]);
  });

  it("leaves no timer behind when unmounted mid-swap", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderSet([A]);
    rerender({ items: [B] });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
