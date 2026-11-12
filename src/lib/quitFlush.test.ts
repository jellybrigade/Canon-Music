import { afterEach, describe, expect, it, vi } from "vitest";
import { onQuit, runQuitFlushes } from "./quitFlush";

const unregisters: (() => void)[] = [];

function register(flush: () => Promise<unknown>) {
  unregisters.push(onQuit(flush));
}

afterEach(() => {
  for (const unregister of unregisters.splice(0)) unregister();
  vi.useRealTimers();
});

describe("runQuitFlushes", () => {
  it("waits for every registered flush to finish", async () => {
    const finished: string[] = [];
    register(async () => {
      await Promise.resolve();
      finished.push("queue");
    });
    register(async () => {
      finished.push("volume");
    });

    await runQuitFlushes(1000);

    expect(finished.sort()).toEqual(["queue", "volume"]);
  });

  it("still runs the others when one flush throws", async () => {
    const finished: string[] = [];
    register(() => {
      throw new Error("boom");
    });
    register(async () => {
      finished.push("queue");
    });

    await runQuitFlushes(1000);

    expect(finished).toEqual(["queue"]);
  });

  it("gives up on a flush that outlives the deadline", async () => {
    vi.useFakeTimers();
    register(() => new Promise(() => {}));

    let isDone = false;
    const run = runQuitFlushes(3000).then(() => {
      isDone = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(isDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;

    expect(isDone).toBe(true);
  });

  it("leaves no timer armed after the flushes finish", async () => {
    vi.useFakeTimers();
    register(async () => {});

    await runQuitFlushes(3000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips a flush once it is unregistered", async () => {
    const flush = vi.fn(async () => {});
    const unregister = onQuit(flush);
    unregister();

    await runQuitFlushes(1000);

    expect(flush).not.toHaveBeenCalled();
  });
});
