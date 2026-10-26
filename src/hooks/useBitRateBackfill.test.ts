// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBitRateBackfill } from "./useBitRateBackfill";

afterEach(() => vi.restoreAllMocks());

const noBitRate = [{ bit_rate: null }, { bit_rate: null }];

describe("useBitRateBackfill", () => {
  it("re-syncs an album whose tracks all lack a bit rate once", async () => {
    const syncTracks = vi.fn(() => Promise.resolve());
    const { rerender } = renderHook(({ tracks }) => useBitRateBackfill("al-1", tracks, syncTracks), {
      initialProps: { tracks: noBitRate },
    });
    rerender({ tracks: [...noBitRate] });

    await waitFor(() => expect(syncTracks).toHaveBeenCalledTimes(1));
  });

  it("leaves an album alone when any track has a bit rate", () => {
    const syncTracks = vi.fn(() => Promise.resolve());
    renderHook(() => useBitRateBackfill("al-1", [{ bit_rate: null }, { bit_rate: 320 }], syncTracks));

    expect(syncTracks).not.toHaveBeenCalled();
  });

  it("logs a failed re-sync instead of leaving it unhandled", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("server down");
    renderHook(() => useBitRateBackfill("al-1", noBitRate, () => Promise.reject(failure)));

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure));
  });
});
