// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../hooks/useSetting", () => ({
  useBoolSetting: () => [showWaveform, vi.fn(), true],
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { usePlayerStore } from "../store/player";
import { PlayerProgress } from "./PlayerProgress";

let showWaveform = true;

const bar = () => document.querySelector(".player-progress-bar");
const waveformBars = () => Array.from(document.querySelectorAll<HTMLElement>(".waveform-bar"));

beforeEach(() => {
  showWaveform = true;
  act(() => usePlayerStore.setState({ waveformPeaks: [0.3, 0.9, 0.6] }));
});

afterEach(() => {
  cleanup();
  act(() => usePlayerStore.setState({ waveformPeaks: null }));
});

describe("PlayerProgress", () => {
  it("keeps the waveform height while the next track's peaks load", () => {
    render(<PlayerProgress />);
    expect(bar()?.classList.contains("player-progress-bar--waveform")).toBe(true);

    act(() => usePlayerStore.setState({ waveformPeaks: null }));

    expect(bar()?.classList.contains("player-progress-bar--waveform")).toBe(true);
    expect(document.querySelector(".player-progress-fill")).toBeNull();
  });

  it("shows a flat placeholder, not the previous track's shape, while peaks load", () => {
    render(<PlayerProgress />);
    act(() => usePlayerStore.setState({ waveformPeaks: null }));

    const heights = new Set(waveformBars().map((b) => b.style.getPropertyValue("--peak")));
    expect(heights.size).toBe(1);
    expect(heights.has("0.9")).toBe(false);
  });

  it("shows the plain bar when the waveform is turned off", () => {
    showWaveform = false;
    render(<PlayerProgress />);
    expect(bar()?.classList.contains("player-progress-bar--waveform")).toBe(false);
    expect(document.querySelector(".player-progress-fill")).not.toBeNull();
  });
});
