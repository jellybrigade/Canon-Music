import { describe, it, expect, vi } from "vitest";

describe("For You seed", () => {
  it("stays the same across Home mounts in one session", async () => {
    vi.resetModules();
    const { getForYouSeed } = await import("./forYouSeed");
    expect(getForYouSeed()).toBe(getForYouSeed());
  });

  it("keeps a refreshed seed for the next mount", async () => {
    vi.resetModules();
    const { getForYouSeed, nextForYouSeed } = await import("./forYouSeed");
    const before = getForYouSeed();
    const refreshed = nextForYouSeed();
    expect(refreshed).not.toBe(before);
    expect(getForYouSeed()).toBe(refreshed);
  });

  it("varies per launch", async () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.1);
    vi.resetModules();
    const first = (await import("./forYouSeed")).getForYouSeed();
    random.mockReturnValueOnce(0.7);
    vi.resetModules();
    const second = (await import("./forYouSeed")).getForYouSeed();
    random.mockRestore();
    expect(first).not.toBe(second);
  });
});
