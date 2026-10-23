// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { useVisualizerTap } from "./useVisualizerTap";

const activations = () =>
  invoke.mock.calls.filter(([cmd]) => cmd === "audio_visualizer_set_active").map(([, args]) => args);

beforeEach(() => resetTauriMocks());

describe("useVisualizerTap", () => {
  it("turns the engine's copy on once while on screen and off when it leaves", () => {
    const { rerender, unmount } = renderHook(({ isOnScreen }) => useVisualizerTap(isOnScreen), {
      initialProps: { isOnScreen: true },
    });
    rerender({ isOnScreen: true });
    expect(activations()).toEqual([{ active: true }]);

    rerender({ isOnScreen: false });
    expect(activations()).toEqual([{ active: true }, { active: false }]);

    unmount();
    expect(activations()).toHaveLength(2);
  });

  it("never turns it on while off screen", () => {
    const { unmount } = renderHook(() => useVisualizerTap(false));
    unmount();
    expect(activations()).toEqual([]);
  });

  it("ends on, not off, under StrictMode's remount", () => {
    renderHook(() => useVisualizerTap(true), { reactStrictMode: true });
    const calls = activations();
    expect(calls[calls.length - 1]).toEqual({ active: true });
  });
});
