// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);

import { isProgressJump } from "./useSeekBar";

describe("isProgressJump", () => {
  const DURATION = 100;

  it("treats one poll's forward advance as playback, not a jump", () => {
    expect(isProgressJump(0.5, 0.502, DURATION)).toBe(false);
  });

  it("treats any backward move as a jump", () => {
    expect(isProgressJump(0.5, 0.1, DURATION)).toBe(true);
  });

  it("treats a forward move larger than a poll as a jump", () => {
    expect(isProgressJump(0.1, 0.6, DURATION)).toBe(true);
  });

  it("treats no movement as playback", () => {
    expect(isProgressJump(0.5, 0.5, DURATION)).toBe(false);
  });
});
