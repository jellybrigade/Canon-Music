// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useMeasuredElement } from "./useMeasuredElement";

const WIDTH = 640;
const HEIGHT = 480;
const SCROLLBAR = 15;

const observed: HTMLElement[] = [];
const disconnects: number[] = [];
let fireResize: ((width: number, height: number) => void) | null = null;

beforeAll(() => {
  class StubResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      fireResize = (width, height) => {
        act(() => {
          callback(
            [{ contentRect: { width, height } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver
          );
        });
      };
    }
    observe(el: HTMLElement) { observed.push(el); }
    unobserve() {}
    disconnect() { disconnects.push(1); }
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  // The observer reports the content box, so the initial synchronous measurement has to
  // read the same box. offset* is the border box and on a scrolling element it is wider by
  // the scrollbar gutter, modelled here so a regression back to it is visible.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => WIDTH });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => WIDTH + SCROLLBAR });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => HEIGHT });
});

afterEach(() => {
  cleanup();
  observed.length = 0;
  disconnects.length = 0;
  fireResize = null;
});

let renders = 0;

function LateBox({ ready }: { ready: boolean }) {
  const { attach, width, height } = useMeasuredElement<HTMLDivElement>();
  renders++;
  if (!ready) return <p>Loading</p>;
  return <div ref={attach} data-testid="box" data-size={`${width}x${height}`} />;
}

function size(): string {
  return document.querySelector<HTMLElement>("[data-testid='box']")!.dataset.size!;
}

describe("useMeasuredElement", () => {
  it("measures an element that only renders once content arrives", () => {
    const view = render(<LateBox ready={false} />);
    view.rerender(<LateBox ready={true} />);
    expect(size()).toBe(`${WIDTH}x${HEIGHT}`);
  });

  it("measures an element present from the first render", () => {
    render(<LateBox ready={true} />);
    expect(size()).toBe(`${WIDTH}x${HEIGHT}`);
  });

  it("measures in the same box the observer reports, not the border box", () => {
    render(<LateBox ready={true} />);
    // The scrollbar gutter must not be counted: a first measurement one gutter wider than
    // every later one relays the whole grid after first paint.
    expect(size()).toBe(`${WIDTH}x${HEIGHT}`);
  });

  it("observes once and disconnects on unmount", () => {
    const view = render(<LateBox ready={false} />);
    view.rerender(<LateBox ready={true} />);
    view.rerender(<LateBox ready={true} />);
    expect(observed).toHaveLength(1);
    view.unmount();
    expect(disconnects).toHaveLength(1);
  });

  it("re-renders once per real size change and never for a repeated one", () => {
    const view = render(<LateBox ready={false} />);
    view.rerender(<LateBox ready={true} />);
    const settled = renders;

    // A ResizeObserver fires on plenty of passes that change nothing - a scroll that shifts
    // a scrollbar, a sibling collapsing. Every one of those would otherwise re-render every
    // card in the grid reading this size.
    // React re-renders once on a state write it then finds equal, and bails out from there,
    // so five identical resizes cost one pass rather than five.
    for (let i = 0; i < 5; i++) fireResize!(WIDTH, HEIGHT);
    expect(renders).toBe(settled + 1);

    fireResize!(WIDTH - 100, HEIGHT);
    expect(renders).toBe(settled + 2);
    expect(size()).toBe(`${WIDTH - 100}x${HEIGHT}`);
  });
});
