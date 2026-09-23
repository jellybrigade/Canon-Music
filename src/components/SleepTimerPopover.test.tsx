// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { createRef, Profiler } from "react";
import { usePlayerStore } from "../store/player";
import { SleepTimerPopover } from "./SleepTimerPopover";

const activeLabels = () =>
  Array.from(document.querySelectorAll(".timer-popover-item--active")).map((el) => el.textContent);

function mount(onClose = () => {}) {
  render(<SleepTimerPopover popoverRef={createRef()} position={null} onClose={onClose} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.getState().clearSleepTimer();
});

afterEach(() => {
  cleanup();
  usePlayerStore.getState().clearSleepTimer();
  vi.useRealTimers();
});

describe("SleepTimerPopover", () => {
  it("marks only the preset that was chosen as active", () => {
    usePlayerStore.getState().setSleepTimer(30);
    mount();
    expect(activeLabels()).toEqual(["30 min"]);
  });

  it("marks only end of track when that mode is armed", () => {
    usePlayerStore.getState().setSleepTimer("end-of-track");
    mount();
    expect(activeLabels()).toEqual(["End of track"]);
  });

  it("marks nothing and offers no Off row while no timer is armed", () => {
    mount();
    expect(activeLabels()).toEqual([]);
    expect(document.querySelector(".timer-popover-item--off")).toBeNull();
    expect(document.querySelectorAll(".timer-popover-item").length).toBe(5);
  });

  it("choosing a preset arms that many minutes and closes the popover", () => {
    const onClose = vi.fn();
    mount(onClose);
    fireEvent.click(Array.from(document.querySelectorAll(".timer-popover-item")).find((el) => el.textContent === "45 min")!);
    expect(usePlayerStore.getState().sleepTimerEndsAt).toBe(Date.now() + 45 * 60 * 1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Off disarms the timer", () => {
    usePlayerStore.getState().setSleepTimer(15);
    mount();
    fireEvent.click(document.querySelector(".timer-popover-item--off")!);
    expect(usePlayerStore.getState().sleepTimerEndsAt).toBeNull();
    expect(activeLabels()).toEqual([]);
  });

  it("does not re-render on playback progress, only on the timer it shows", () => {
    let commits = 0;
    render(
      <Profiler id="timer" onRender={() => { commits++; }}>
        <SleepTimerPopover popoverRef={createRef()} position={null} onClose={() => {}} />
      </Profiler>,
    );
    const mounted = commits;
    for (let i = 1; i <= 20; i++) act(() => usePlayerStore.setState({ elapsed: i }));
    expect(commits - mounted).toBe(0);
    act(() => usePlayerStore.getState().setSleepTimer(15));
    expect(commits - mounted).toBe(1);
  });
});
