// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);

import { act, renderHook } from "@testing-library/react";
import { usePlayerStore } from "../store/player";
import { useWakeLock } from "./useWakeLock";

type FakeSentinel = { released: boolean; release: ReturnType<typeof vi.fn> };

function makeSentinel(): FakeSentinel {
  const sentinel: FakeSentinel = {
    released: false,
    release: vi.fn(() => {
      sentinel.released = true;
      return Promise.resolve();
    }),
  };
  return sentinel;
}

let pending: Array<(sentinel: FakeSentinel) => void>;
let request: ReturnType<typeof vi.fn>;

function fireVisibility() {
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  pending = [];
  request = vi.fn(() => new Promise<FakeSentinel>((resolve) => pending.push(resolve)));
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  usePlayerStore.setState({ isPlaying: false });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "wakeLock");
});

describe("useWakeLock", () => {
  it("releases a lock that resolves after playback paused", async () => {
    renderHook(() => useWakeLock());
    act(() => usePlayerStore.setState({ isPlaying: true }));
    expect(request).toHaveBeenCalledTimes(1);

    act(() => usePlayerStore.setState({ isPlaying: false }));
    const sentinel = makeSentinel();
    await act(async () => pending[0]?.(sentinel));

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("asks for one lock while a request is still pending", async () => {
    renderHook(() => useWakeLock());
    act(() => usePlayerStore.setState({ isPlaying: true }));
    act(() => fireVisibility());

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases every lock it was granted when playback pauses", async () => {
    renderHook(() => useWakeLock());
    act(() => usePlayerStore.setState({ isPlaying: true }));
    act(() => fireVisibility());
    const granted = pending.map((resolve) => {
      const sentinel = makeSentinel();
      return { resolve, sentinel };
    });
    await act(async () => granted.forEach(({ resolve, sentinel }) => resolve(sentinel)));

    act(() => usePlayerStore.setState({ isPlaying: false }));

    for (const { sentinel } of granted) expect(sentinel.released).toBe(true);
  });

  it("asks again once the browser dropped the lock on hide", async () => {
    renderHook(() => useWakeLock());
    act(() => usePlayerStore.setState({ isPlaying: true }));
    const sentinel = makeSentinel();
    await act(async () => pending[0]?.(sentinel));

    sentinel.released = true;
    act(() => fireVisibility());

    expect(request).toHaveBeenCalledTimes(2);
  });
});
