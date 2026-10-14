// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { usePlayerStore } from "../store/player";
import { PlayerMoreControls } from "./PlayerMoreControls";
import { __resetModalRegistry, useModalChrome } from "../../../ui/useModalChrome";

function OpenModal() {
  const chrome = useModalChrome(() => {});
  return <div {...chrome} />;
}

interface Handlers {
  onOpenTimer?: (anchor: HTMLElement) => void;
  onOpenCast?: (anchor: HTMLElement) => void;
  onNowPlaying?: () => void;
  timerLabel?: string;
  isTimerActive?: boolean;
  castDeviceName?: string | null;
}

function controls({ onOpenTimer = () => {}, onOpenCast = () => {}, onNowPlaying = () => {}, timerLabel = "", isTimerActive = false, castDeviceName = null }: Handlers = {}) {
  return (
    <PlayerMoreControls
      onOpenTimer={onOpenTimer}
      onOpenCast={onOpenCast}
      onNowPlaying={onNowPlaying}
      timerLabel={timerLabel}
      isTimerActive={isTimerActive}
      castDeviceName={castDeviceName}
    />
  );
}

function mount(handlers: Handlers = {}) {
  return render(controls(handlers));
}

const moreButton = () => document.querySelector<HTMLButtonElement>(".player-more-btn")!;
const menu = () => document.querySelector(".player-more-menu");
const rowLabels = () =>
  Array.from(document.querySelectorAll(".player-more-row__label")).map((el) => el.textContent);
const rowNamed = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(".player-more-row")).find(
    (el) => el.querySelector(".player-more-row__label")?.textContent === label,
  )!;
const hasActiveDot = () => moreButton().classList.contains("player-more-btn--has-active");

beforeEach(() => {
  usePlayerStore.getState().clearSleepTimer();
  usePlayerStore.setState({ volume: 0.72 });
});

afterEach(() => {
  cleanup();
  usePlayerStore.getState().clearSleepTimer();
  __resetModalRegistry();
  vi.useRealTimers();
});

describe("PlayerMoreControls", () => {
  it("opens a menu with volume, sleep timer, cast and now playing, in that order", () => {
    mount();
    expect(menu()).toBeNull();
    fireEvent.click(moreButton());
    expect(rowLabels()).toEqual(["Volume", "Sleep timer", "Cast", "Now playing"]);
    expect(menu()!.querySelector(".player-more-volume__value")!.textContent).toBe("72%");
  });

  it("shows the timer and cast state beside their rows", () => {
    mount({ timerLabel: "23:10", isTimerActive: true, castDeviceName: "Living room" });
    fireEvent.click(moreButton());
    expect(rowNamed("Sleep timer").querySelector(".player-more-row__state")!.textContent).toBe("23:10");
    expect(rowNamed("Cast").querySelector(".player-more-row__state")!.textContent).toBe("Living room");
  });

  it("shows off and this computer while nothing is armed", () => {
    mount();
    fireEvent.click(moreButton());
    expect(rowNamed("Sleep timer").querySelector(".player-more-row__state")!.textContent).toBe("Off");
    expect(rowNamed("Cast").querySelector(".player-more-row__state")!.textContent).toBe("This computer");
  });

  it("the sleep timer row hands off to the timer popover anchored on the more button", () => {
    const onOpenTimer = vi.fn();
    mount({ onOpenTimer });
    fireEvent.click(moreButton());
    fireEvent.click(rowNamed("Sleep timer"));
    expect(onOpenTimer).toHaveBeenCalledTimes(1);
    expect(onOpenTimer).toHaveBeenCalledWith(moreButton());
    expect(menu()).toBeNull();
  });

  it("the cast row hands off to the cast popover anchored on the more button", () => {
    const onOpenCast = vi.fn();
    mount({ onOpenCast });
    fireEvent.click(moreButton());
    fireEvent.click(rowNamed("Cast"));
    expect(onOpenCast).toHaveBeenCalledTimes(1);
    expect(onOpenCast).toHaveBeenCalledWith(moreButton());
    expect(menu()).toBeNull();
  });

  it("the now playing row opens the now playing view and closes the menu", () => {
    const onNowPlaying = vi.fn();
    mount({ onNowPlaying });
    fireEvent.click(moreButton());
    fireEvent.click(rowNamed("Now playing"));
    expect(onNowPlaying).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("the volume slider sets the volume without closing the menu", () => {
    mount();
    fireEvent.click(moreButton());
    fireEvent.change(menu()!.querySelector<HTMLInputElement>(".player-volume-slider")!, { target: { value: "0.3" } });
    expect(usePlayerStore.getState().volume).toBe(0.3);
    expect(menu()).not.toBeNull();
  });

  it("says the timer is on while it is armed but its countdown is not in yet", () => {
    mount({ isTimerActive: true });
    fireEvent.click(moreButton());
    expect(rowNamed("Sleep timer").querySelector(".player-more-row__state")!.textContent).toBe("On");
  });

  it("marks the more button while a sleep timer is armed", () => {
    const { rerender } = mount();
    expect(hasActiveDot()).toBe(false);
    rerender(controls({ isTimerActive: true }));
    expect(hasActiveDot()).toBe(true);
  });

  it("marks the more button while casting", () => {
    const { rerender } = mount();
    expect(hasActiveDot()).toBe(false);
    rerender(controls({ castDeviceName: "Living room" }));
    expect(hasActiveDot()).toBe(true);
  });

  it("closes on a click outside", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.click(moreButton());
    act(() => vi.advanceTimersByTime(0));
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
  });

  it("closes on Escape", () => {
    mount();
    fireEvent.click(moreButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu()).toBeNull();
  });

  it("leaves Escape to a modal painted over it", () => {
    mount();
    fireEvent.click(moreButton());
    render(<OpenModal />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu()).not.toBeNull();
  });

  it("closes when the window is resized, since its position was measured at open", () => {
    mount();
    fireEvent.click(moreButton());
    fireEvent(window, new Event("resize"));
    expect(menu()).toBeNull();
  });
});
