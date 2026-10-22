import { describe, expect, it } from "vitest";
import { emptyBars, isSettled, PEAK_HOLD_MS, stepBars } from "./visualizerMotion";

const full = (count: number) => Array.from({ length: count }, () => 1);
const silent = (count: number) => Array.from({ length: count }, () => 0);

function run(bars: ReturnType<typeof emptyBars>, targets: number[], totalMs: number, frameMs = 16) {
  let state = bars;
  for (let t = 0; t < totalMs; t += frameMs) state = stepBars(state, targets, frameMs);
  return state;
}

describe("stepBars", () => {
  it("rises to a loud target within a few frames", () => {
    const state = run(emptyBars(4), full(4), 300);
    expect(state.levels.every((level) => level > 0.9)).toBe(true);
  });

  it("falls more slowly than it rises", () => {
    const risen = run(emptyBars(1), full(1), 50);
    const fallen = run(run(emptyBars(1), full(1), 1000), silent(1), 50);
    expect(risen.levels[0]).toBeGreaterThan(1 - fallen.levels[0]!);
  });

  it("looks the same at any frame rate", () => {
    const at60 = run(emptyBars(1), full(1), 96, 16);
    const at144 = run(emptyBars(1), full(1), 96, 96 / 14);
    expect(at144.levels[0]).toBeCloseTo(at60.levels[0]!, 2);
  });

  it("holds a peak before letting it drift down", () => {
    const peaked = run(emptyBars(1), full(1), 500);
    const held = run(peaked, silent(1), PEAK_HOLD_MS - 50);
    expect(held.peaks[0]).toBeCloseTo(peaked.peaks[0]!, 5);
    const drifting = run(held, silent(1), 300);
    expect(drifting.peaks[0]).toBeLessThan(held.peaks[0]!);
  });

  it("never lets a peak sit below its bar", () => {
    let state = emptyBars(1);
    for (let i = 0; i < 200; i++) state = stepBars(state, [i % 20 < 10 ? 1 : 0], 16);
    expect(state.peaks[0]).toBeGreaterThanOrEqual(state.levels[0]!);
  });

  it("treats a long gap between frames as one short frame", () => {
    const state = stepBars(run(emptyBars(1), full(1), 1000), silent(1), 60_000);
    expect(state.levels[0]).toBeGreaterThan(0.5);
  });

  it("reads missing targets as silence", () => {
    const state = run(run(emptyBars(3), full(3), 500), [1], 2000);
    expect(state.levels[0]).toBeGreaterThan(0.9);
    expect(state.levels[2]).toBeLessThan(0.01);
  });
});

describe("isSettled", () => {
  it("is true only once bars and peaks are back on the baseline", () => {
    const loud = run(emptyBars(2), full(2), 500);
    expect(isSettled(loud)).toBe(false);
    expect(isSettled(run(loud, silent(2), 5000))).toBe(true);
    expect(isSettled(emptyBars(2))).toBe(true);
  });
});
