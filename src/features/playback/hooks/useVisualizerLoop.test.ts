// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import type { Bars } from "../lib/visualizerMotion";
import { useVisualizerLoop } from "./useVisualizerLoop";

let pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let now = 0;

function runFrame(stepMs = 16) {
  now += stepMs;
  const frames = pendingFrames;
  pendingFrames = new Map();
  for (const callback of frames.values()) callback(now);
}

async function flushInvokes() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const levelRequests = () => invoke.mock.calls.filter(([cmd]) => cmd === "audio_visualizer_levels").length;

beforeEach(() => {
  resetTauriMocks();
  pendingFrames = new Map();
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    pendingFrames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pendingFrames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderLoop(initial: { isPlaying: boolean; isOnScreen?: boolean; width?: number; pixelRatio?: number }) {
  const canvasRef = { current: document.createElement("canvas") };
  const drawn: Bars[] = [];
  const draw = (_: CanvasRenderingContext2D, bars: Bars) => {
    drawn.push(bars);
  };
  const view = renderHook(
    ({ isPlaying, isOnScreen, width, pixelRatio }) =>
      useVisualizerLoop({
        canvasRef,
        width,
        height: 200,
        pixelRatio,
        barCount: 4,
        isOnScreen,
        isPlaying,
        colorKey: null,
        draw,
      }),
    {
      initialProps: {
        isPlaying: initial.isPlaying,
        isOnScreen: initial.isOnScreen ?? true,
        width: initial.width ?? 200,
        pixelRatio: initial.pixelRatio ?? 1,
      },
    },
  );
  return { ...view, drawn, canvas: canvasRef.current };
}

describe("useVisualizerLoop", () => {
  it("keeps at most one level request in flight", async () => {
    let answer: (levels: number[]) => void = () => {};
    onInvoke("audio_visualizer_levels", () => new Promise<number[]>((resolve) => (answer = resolve)));
    renderLoop({ isPlaying: true });

    runFrame();
    runFrame();
    runFrame();
    expect(levelRequests()).toBe(1);

    answer([1, 1, 1, 1]);
    await flushInvokes();
    runFrame();
    expect(levelRequests()).toBe(2);
  });

  it("draws the levels the engine reports", async () => {
    onInvoke("audio_visualizer_levels", () => [1, 1, 1, 1]);
    const { drawn } = renderLoop({ isPlaying: true });

    runFrame();
    await flushInvokes();
    for (let i = 0; i < 10; i++) runFrame();
    expect(drawn[drawn.length - 1]!.levels.every((level) => level > 0.5)).toBe(true);
  });

  it("lets the bars fall while paused, then stops asking for frames", async () => {
    onInvoke("audio_visualizer_levels", () => [1, 1, 1, 1]);
    const { rerender } = renderLoop({ isPlaying: true });
    runFrame();
    await flushInvokes();
    for (let i = 0; i < 10; i++) runFrame();

    rerender({ isPlaying: false, isOnScreen: true, width: 200, pixelRatio: 1 });
    const requestsWhenPaused = levelRequests();
    for (let i = 0; i < 400 && pendingFrames.size > 0; i++) runFrame();

    expect(pendingFrames.size).toBe(0);
    expect(levelRequests()).toBe(requestsWhenPaused);
  });

  it("does nothing off screen and cancels its frame on unmount", () => {
    const offScreen = renderLoop({ isPlaying: true, isOnScreen: false });
    expect(pendingFrames.size).toBe(0);
    offScreen.unmount();

    const onScreen = renderLoop({ isPlaying: true });
    expect(pendingFrames.size).toBe(1);
    onScreen.unmount();
    expect(pendingFrames.size).toBe(0);
  });

  it("keeps one level request in flight across a resize", async () => {
    let answer: (levels: number[]) => void = () => {};
    onInvoke("audio_visualizer_levels", () => new Promise<number[]>((resolve) => (answer = resolve)));
    const { rerender } = renderLoop({ isPlaying: true });
    runFrame();

    rerender({ isPlaying: true, isOnScreen: true, width: 300, pixelRatio: 1 });
    runFrame();
    runFrame();
    expect(levelRequests()).toBe(1);

    answer([1, 1, 1, 1]);
    await flushInvokes();
    runFrame();
    expect(levelRequests()).toBe(2);
  });

  it("sizes the canvas for the current pixel ratio", () => {
    const { canvas, rerender } = renderLoop({ isPlaying: false, pixelRatio: 1 });
    expect(canvas.width).toBe(200);

    rerender({ isPlaying: false, isOnScreen: true, width: 200, pixelRatio: 2 });
    expect(canvas.width).toBe(400);
  });
});
