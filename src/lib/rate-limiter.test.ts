import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRateLimiter } from "./rate-limiter";

describe("makeRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Not epoch 0: the limiter starts with `lastRequestAt = 0`, so at a system time of 0 the
    // very first call looks like it happened one interval ago and gets delayed.
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the first call through immediately", async () => {
    const rateLimit = makeRateLimiter(1000);
    let settled = false;
    void rateLimit().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it("delays a second call by the interval", async () => {
    const rateLimit = makeRateLimiter(1000);
    await rateLimit();
    let settled = false;
    void rateLimit().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("serializes concurrent callers one interval apart", async () => {
    const rateLimit = makeRateLimiter(200);
    const start = Date.now();
    const at: number[] = [];
    const calls = [0, 1, 2, 3].map(() => rateLimit().then(() => at.push(Date.now() - start)));
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(calls);
    expect(at).toEqual([0, 200, 400, 600]);
  });

  it("does not delay a call that arrives after the interval has already elapsed", async () => {
    const rateLimit = makeRateLimiter(500);
    await rateLimit();
    await vi.advanceTimersByTimeAsync(5000);
    let settled = false;
    void rateLimit().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });
});
