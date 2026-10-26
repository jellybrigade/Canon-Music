import { afterEach, describe, expect, it, vi } from "vitest";

// A plain function, not vi.fn: vi.fn attaches its own handler to every returned promise to
// record settled results, which would hide the unhandled rejection this file checks for.
const invokeCalls: unknown[][] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    invokeCalls.push(args);
    return Promise.reject(new Error("ipc down"));
  },
}));

import { LocalTarget } from "./playbackTarget";

const unhandled: unknown[] = [];
const recordUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off("unhandledRejection", recordUnhandled);
  unhandled.length = 0;
  invokeCalls.length = 0;
});

describe("LocalTarget.setNext", () => {
  it("swallows a failed prefetch instead of leaving an unhandled rejection", async () => {
    process.on("unhandledRejection", recordUnhandled);

    await new LocalTarget().setNext("https://music.example/next");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(invokeCalls).toEqual([["audio_prefetch", { url: "https://music.example/next" }]]);
    expect(unhandled).toEqual([]);
  });
});
