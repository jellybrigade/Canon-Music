import { describe, expect, it } from "vitest";
import { createSettlingRunner } from "./settlingRunner";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createSettlingRunner", () => {
  it("runs once more after requests that arrive mid-run, however many", async () => {
    const gates = [deferred(), deferred()];
    let runs = 0;
    const request = createSettlingRunner(async () => {
      await gates[runs++]?.promise;
    });

    const first = request();
    void request();
    void request();
    gates[0]?.resolve();
    gates[1]?.resolve();
    await first;

    expect(runs).toBe(2);
  });

  it("reruns with the latest request's argument", async () => {
    const gate = deferred();
    const seen: number[] = [];
    const request = createSettlingRunner(async (value: number) => {
      seen.push(value);
      if (value === 1) await gate.promise;
    });

    const first = request(1);
    void request(2);
    void request(3);
    gate.resolve();
    await first;

    expect(seen).toEqual([1, 3]);
  });

  it("runs again after a failed run", async () => {
    let runs = 0;
    const request = createSettlingRunner(async () => {
      runs++;
      throw new Error("down");
    });

    await expect(request()).rejects.toThrow("down");
    await expect(request()).rejects.toThrow("down");
    expect(runs).toBe(2);
  });
});
