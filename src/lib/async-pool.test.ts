import { describe, expect, it, vi } from "vitest";
import { runPool } from "./async-pool";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runPool", () => {
  it("never exceeds the concurrency ceiling", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runPool(
      Array.from({ length: 40 }, (_, i) => i),
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
      },
      { concurrency: 4 }
    );
    expect(maxInFlight).toBe(4);
  });

  it("starts concurrency workers at once, not one at a time", async () => {
    const gate = deferred();
    const started: number[] = [];
    const run = runPool(
      [0, 1, 2, 3, 4],
      async (item) => {
        started.push(item);
        await gate.promise;
      },
      { concurrency: 3 }
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gate.resolve();
    await run;
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("visits every item when concurrency exceeds the item count", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3], async (item) => void seen.push(item), { concurrency: 10 });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("keeps going when one item throws", async () => {
    const seen: number[] = [];
    await runPool(
      [1, 2, 3, 4],
      async (item) => {
        if (item === 2) throw new Error("bad item");
        seen.push(item);
      },
      { concurrency: 1 }
    );
    expect(seen).toEqual([1, 3, 4]);
  });

  it("reports progress once per settled item, failures included", async () => {
    const onProgress = vi.fn();
    await runPool(
      [1, 2, 3],
      async (item) => {
        if (item === 2) throw new Error("bad item");
      },
      { concurrency: 1, onProgress }
    );
    expect(onProgress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("stops pulling work once the signal aborts", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      async (item) => {
        seen.push(item);
        if (item === 2) controller.abort();
      },
      { concurrency: 1, signal: controller.signal }
    );
    expect(seen).toEqual([0, 1, 2]);
  });

  it("reports a zero total for empty input and runs no worker", async () => {
    const onProgress = vi.fn();
    const worker = vi.fn();
    await runPool([], worker, { concurrency: 4, onProgress });
    expect(worker).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0, 0);
  });
});
