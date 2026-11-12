import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { DEEZER_QUOTA_COOLDOWN_MS, searchDeezerAlbums } from "./deezer";

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(tauriFetch).mockReset();
});

describe("Deezer quota", () => {
  it("rejects on the quota error Deezer sends with HTTP 200, then holds off the host", async () => {
    vi.useFakeTimers();
    vi.mocked(tauriFetch).mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }), {
          status: 200,
        }),
    );

    await expect(searchDeezerAlbums("PISS", "x")).rejects.toThrow("Quota");
    expect(tauriFetch).toHaveBeenCalledTimes(1);

    const next = searchDeezerAlbums("PISS", "y").catch(() => {});
    await vi.advanceTimersByTimeAsync(DEEZER_QUOTA_COOLDOWN_MS - 1000);
    expect(tauriFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await next;
    expect(tauriFetch).toHaveBeenCalledTimes(2);
  });
});
