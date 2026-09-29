import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLyricsOvh } from "./lyricsOvh";

function respondWith(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLyricsOvh", () => {
  it("answers null when lyrics.ovh has no lyrics for the track", async () => {
    respondWith(404, { error: "No lyrics found" });
    await expect(fetchLyricsOvh("a", "b")).resolves.toBeNull();
  });

  it("throws when lyrics.ovh fails, so the miss is not cached as final", async () => {
    respondWith(503, {});
    await expect(fetchLyricsOvh("a", "b")).rejects.toThrow("503");
  });
});
