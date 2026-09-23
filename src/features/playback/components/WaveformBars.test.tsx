// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WaveformBars } from "./WaveformBars";

function renderBars(peaks: number[], filledCount = 0) {
  const { container } = render(
    <WaveformBars
      peaks={peaks}
      filledCount={filledCount}
      barClass="bar"
      filledClass="bar bar--filled"
    />
  );
  return Array.from(container.querySelectorAll<HTMLElement>(".bar"));
}

describe("WaveformBars", () => {
  it("renders one bar per peak and marks the filled ones", () => {
    const bars = renderBars([0.1, 0.5, 0.9, 0.4], 2);
    expect(bars).toHaveLength(4);
    expect(bars.filter((b) => b.classList.contains("bar--filled"))).toHaveLength(2);
  });

  it("renders nothing for an empty peak list", () => {
    expect(renderBars([])).toHaveLength(0);
  });

  it("gives each bar its peak height", () => {
    const bars = renderBars([0.1, 0.5]);
    expect(bars[0]!.style.getPropertyValue("--peak")).toBe("0.1");
    expect(bars[1]!.style.getPropertyValue("--peak")).toBe("0.5");
  });

  it("gives each bar its position across the run so the buffering sweep can stagger", () => {
    const bars = renderBars([0.1, 0.2, 0.3, 0.4]);
    expect(bars.map((b) => b.style.getPropertyValue("--bar-phase"))).toEqual([
      "0",
      "0.25",
      "0.5",
      "0.75",
    ]);
  });

  it("phases a single bar at the start of the sweep rather than dividing by zero", () => {
    const bars = renderBars([0.6]);
    expect(bars[0]!.style.getPropertyValue("--bar-phase")).toBe("0");
  });
});
