// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WaveformBars } from "./WaveformBars";

const PITCH = 4;
let measuredWidth = 0;
let fireResize: ((width: number) => void) | null = null;
const originalResizeObserver = globalThis.ResizeObserver;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

beforeAll(() => {
  class StubResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      fireResize = (width) => {
        act(() => {
          callback(
            [{ contentRect: { width, height: 0 } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        });
      };
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => measuredWidth });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
});

beforeEach(() => {
  measuredWidth = 0;
});

function renderBars(peaks: number[], progress = 0) {
  const { container } = render(
    <WaveformBars peaks={peaks} progress={progress} barPitch={PITCH} barClass="bar" filledClass="bar bar--filled" />,
  );
  return () => Array.from(container.querySelectorAll<HTMLElement>(".bar"));
}

describe("WaveformBars", () => {
  it("renders one bar per peak and marks the played ones", () => {
    const bars = renderBars([0.1, 0.5, 0.9, 0.4], 0.5)();
    expect(bars).toHaveLength(4);
    expect(bars.filter((b) => b.classList.contains("bar--filled"))).toHaveLength(2);
  });

  it("renders nothing for an empty peak list", () => {
    expect(renderBars([])()).toHaveLength(0);
  });

  it("gives each bar its peak height", () => {
    const bars = renderBars([0.1, 0.5])();
    expect(bars[0]!.style.getPropertyValue("--peak")).toBe("0.1");
    expect(bars[1]!.style.getPropertyValue("--peak")).toBe("0.5");
  });

  it("gives each bar its position across the run so the buffering sweep can stagger", () => {
    const bars = renderBars([0.1, 0.2, 0.3, 0.4])();
    expect(bars.map((b) => b.style.getPropertyValue("--bar-phase"))).toEqual(["0", "0.25", "0.5", "0.75"]);
  });

  it("phases a single bar at the start of the sweep rather than dividing by zero", () => {
    const bars = renderBars([0.6])();
    expect(bars[0]!.style.getPropertyValue("--bar-phase")).toBe("0");
  });

  it("draws as many bars as fit the width, so narrow windows don't shrink bars to slivers", () => {
    measuredWidth = 8 * PITCH;
    const bars = renderBars(new Array<number>(200).fill(0.5));
    expect(bars()).toHaveLength(8);

    fireResize?.(20 * PITCH);
    expect(bars()).toHaveLength(20);
  });

  it("fills played bars by position after the bars are merged", () => {
    measuredWidth = 10 * PITCH;
    const bars = renderBars(new Array<number>(200).fill(0.5), 0.3)();
    expect(bars.filter((b) => b.classList.contains("bar--filled"))).toHaveLength(3);
  });
});
