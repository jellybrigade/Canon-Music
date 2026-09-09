// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useClickOutside } from "./useClickOutside";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cleanup();
});

function Harness({ onOutside, enabled }: { onOutside: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onOutside, enabled);
  return (
    <div data-testid="outside">
      <div data-testid="swallower">
        <span data-testid="deep-outside" />
      </div>
      <div ref={ref} data-testid="popover">
        <button data-testid="item">item</button>
      </div>
    </div>
  );
}

function TwoRefHarness({ onOutside }: { onOutside: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useClickOutside([anchor, popover], onOutside);
  return (
    <div data-testid="outside">
      <button ref={anchor} data-testid="anchor">
        open
      </button>
      <div ref={popover} data-testid="popover" />
    </div>
  );
}

const outside = () => screen.getByTestId("outside");
const popover = () => screen.getByTestId("popover");

/** Attach, then let the deferred listener arm. */
function arm() {
  vi.advanceTimersByTime(0);
}

describe("useClickOutside", () => {
  it("ignores the mousedown that opened the popover", () => {
    // WebKitGTK delivers the tail of the opening left-click after the effect runs, so a
    // listener attached synchronously closes the popover the same gesture just opened.
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);

    fireEvent.mouseDown(outside());

    expect(onOutside).not.toHaveBeenCalled();
  });

  it("closes on an outside mousedown once armed", () => {
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);
    arm();

    fireEvent.mouseDown(outside());

    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside mousedown an ancestor stopped propagating", () => {
    // Capture phase: a popover must not be held open by an unrelated subtree that swallows
    // bubbling. Without `capture: true` the document listener never sees this press.
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);
    arm();
    screen
      .getByTestId("swallower")
      .addEventListener("mousedown", (e) => e.stopPropagation());

    fireEvent.mouseDown(screen.getByTestId("deep-outside"));

    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("stays open on a mousedown inside the popover", () => {
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);
    arm();

    fireEvent.mouseDown(screen.getByTestId("item"));

    expect(onOutside).not.toHaveBeenCalled();
  });

  it("treats every supplied ref as inside", () => {
    const onOutside = vi.fn();
    render(<TwoRefHarness onOutside={onOutside} />);
    arm();

    fireEvent.mouseDown(screen.getByTestId("anchor"));
    fireEvent.mouseDown(popover());

    expect(onOutside).not.toHaveBeenCalled();

    fireEvent.mouseDown(outside());

    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} enabled={false} />);
    arm();

    fireEvent.mouseDown(outside());

    expect(onOutside).not.toHaveBeenCalled();
  });

  it("arms on the transition to enabled", () => {
    const onOutside = vi.fn();
    const { rerender } = render(<Harness onOutside={onOutside} enabled={false} />);
    arm();
    rerender(<Harness onOutside={onOutside} enabled />);
    arm();

    fireEvent.mouseDown(outside());

    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("calls the latest handler without re-arming the listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const add = vi.spyOn(document, "addEventListener");
    const { rerender } = render(<Harness onOutside={first} />);
    arm();
    rerender(<Harness onOutside={second} />);
    arm();

    fireEvent.mouseDown(outside());

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === "mousedown")).toHaveLength(1);
  });

  it("leaves no listener behind on unmount", () => {
    const onOutside = vi.fn();
    const { unmount } = render(<Harness onOutside={onOutside} />);
    arm();
    unmount();

    fireEvent.mouseDown(document.body);

    expect(onOutside).not.toHaveBeenCalled();
  });

  it("arms nothing when unmounted before the deferred attach fires", () => {
    const onOutside = vi.fn();
    const add = vi.spyOn(document, "addEventListener");
    const { unmount } = render(<Harness onOutside={onOutside} />);
    unmount();
    arm();

    fireEvent.mouseDown(document.body);

    expect(onOutside).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === "mousedown")).toHaveLength(0);
  });
});
