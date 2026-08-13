// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function menuEl() {
  return document.querySelector<HTMLElement>(".context-menu");
}

describe("ContextMenu", () => {
  it("portals its children onto document.body rather than the render container", () => {
    const { container } = render(
      <ContextMenu x={10} y={10} onClose={vi.fn()}>
        <button>Play</button>
      </ContextMenu>
    );

    expect(container.querySelector(".context-menu")).toBeNull();
    expect(menuEl()).not.toBeNull();
    expect(menuEl()!.textContent).toBe("Play");
  });

  it("survives the mousedown that opened it (WebKitGTK self-close regression)", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose}>
        <button>Play</button>
      </ContextMenu>
    );

    // The mousedown that opened the menu is still propagating to document when
    // the effect runs. The listener attach is deferred behind setTimeout(0)
    // precisely so this event cannot reach it. Attaching synchronously instead
    // makes this assertion fail (verified).
    fireEvent.mouseDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on an outside mousedown once the listener has attached", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose}>
        <button>Play</button>
      </ContextMenu>
    );

    vi.advanceTimersByTime(0);
    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not eat item selection: the full mousedown then click sequence on an item fires its handler and leaves the menu open", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose}>
        <button onClick={onSelect}>Play</button>
      </ContextMenu>
    );

    vi.advanceTimersByTime(0);
    // A real browser dispatches mousedown before click. The mousedown lands
    // inside the menu, so the containment check must not treat it as an
    // outside dismissal and swallow the selection.
    const item = menuEl()!.querySelector("button")!;
    fireEvent.mouseDown(item);
    fireEvent.click(item);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape but not on other keys", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose}>
        <button>Play</button>
      </ContextMenu>
    );

    vi.advanceTimersByTime(0);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on scroll, since the menu is anchored once at open time and never re-anchored", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose}>
        <button>Play</button>
      </ContextMenu>
    );

    vi.advanceTimersByTime(0);
    fireEvent.scroll(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onClose after a re-render, not the one captured when the listener attached", () => {
    const firstOnClose = vi.fn();
    const latestOnClose = vi.fn();
    const { rerender } = render(
      <ContextMenu x={10} y={10} onClose={firstOnClose}>
        <button>Play</button>
      </ContextMenu>
    );

    vi.advanceTimersByTime(0);
    // The listener effect has [] deps, so without the onCloseRef indirection it
    // would keep calling firstOnClose forever.
    rerender(
      <ContextMenu x={10} y={10} onClose={latestOnClose}>
        <button>Play</button>
      </ContextMenu>
    );
    fireEvent.mouseDown(document.body);

    expect(firstOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).toHaveBeenCalledTimes(1);
  });

  it("removes its document listeners on unmount so a later outside mousedown does not call a stale onClose", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ContextMenu x={10} y={10} onClose={onClose}>
        <button>Play</button>
      </ContextMenu>
    );

    vi.advanceTimersByTime(0);
    unmount();
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.scroll(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaks no document listener when unmounted inside the deferred-attach window", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const { unmount } = render(
      <ContextMenu x={10} y={10} onClose={vi.fn()}>
        <button>Play</button>
      </ContextMenu>
    );

    // Unmount inside the setTimeout(0) window. Cleanup has already run its
    // removeEventListener calls, so if clearTimeout does not cancel the pending
    // attach, the listeners go on document after cleanup and stay there forever.
    // Asserting on onClose cannot see this: React nulls menuRef.current on
    // unmount, so the leaked handler's containment guard swallows the call.
    unmount();
    vi.advanceTimersByTime(0);

    const events = addSpy.mock.calls.map((c) => c[0]);
    expect(events).not.toContain("mousedown");
    expect(events).not.toContain("keydown");
    expect(events).not.toContain("scroll");
    addSpy.mockRestore();
  });
});
