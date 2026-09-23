import { describe, it, expect } from "vitest";
import { sleepTimerCountdown } from "./sleepTimer";

describe("sleepTimerCountdown", () => {
  it("formats minutes and zero-padded seconds left", () => {
    expect(sleepTimerCountdown(1_000 + 61_000, 1_000)).toBe("1:01");
    expect(sleepTimerCountdown(30 * 60_000, 0)).toBe("30:00");
  });

  it("rounds a partial second down", () => {
    expect(sleepTimerCountdown(59_999, 0)).toBe("0:59");
  });

  it("reads 0:00 once the deadline has passed instead of going blank", () => {
    expect(sleepTimerCountdown(1_000, 1_000)).toBe("0:00");
    expect(sleepTimerCountdown(1_000, 10 * 60_000)).toBe("0:00");
  });
});
