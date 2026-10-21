import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitHostBudget, makeHostBudget } from "./hostBudget";

describe("awaitHostBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a request until the cooldown ends", async () => {
    const budget = makeHostBudget(250);
    budget.cooldownUntil = Date.now() + 1000;
    let settled = false;
    void awaitHostBudget(budget).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("holds a request already queued behind the interval when a cooldown starts during its wait", async () => {
    const budget = makeHostBudget(250);
    await awaitHostBudget(budget);
    let settled = false;
    void awaitHostBudget(budget).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    budget.cooldownUntil = Date.now() + 1000;

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
