// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { getDb } from "../../db";
import { usePlaylistResumePoint } from "./usePlaylistResumePoint";

const ROWS: Record<string, { last_track_id: string; track_position: number }[]> = {
  "pl-a": [{ last_track_id: "t-shared", track_position: 4 }],
  "pl-b": [{ last_track_id: "t-b", track_position: 9 }],
};

function mockDb(rows: typeof ROWS) {
  const select = vi.fn(async (_sql: string, params: unknown[]) => rows[params[0] as string] ?? []);
  vi.mocked(getDb).mockResolvedValue({ select } as unknown as Awaited<ReturnType<typeof getDb>>);
  return select;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePlaylistResumePoint", () => {
  it("reads the stored resume row for the playlist", async () => {
    mockDb(ROWS);
    const { result } = renderHook(() => usePlaylistResumePoint("pl-a"));

    await waitFor(() => expect(result.current).toEqual({ lastTrackId: "t-shared", trackPosition: 4 }));
  });

  // The page is not remounted between playlists, so the first commit after a switch must not
  // hand the next playlist the previous one's resume row.
  it("never returns the previous playlist's row after the playlist changes", async () => {
    mockDb(ROWS);
    const seenForB: (string | undefined)[] = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const point = usePlaylistResumePoint(id);
        if (id === "pl-b") seenForB.push(point?.lastTrackId);
        return point;
      },
      { initialProps: { id: "pl-a" } },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    rerender({ id: "pl-b" });
    await waitFor(() => expect(result.current?.lastTrackId).toBe("t-b"));

    expect(seenForB).not.toContain("t-shared");
  });

  it("returns null for a playlist with no resume row", async () => {
    const select = mockDb(ROWS);
    const { result } = renderHook(() => usePlaylistResumePoint("pl-none"));

    await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("logs a failed read instead of dropping it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getDb).mockRejectedValue(new Error("db locked"));

    renderHook(() => usePlaylistResumePoint("pl-a"));

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.any(String), expect.any(Error)));
    consoleError.mockRestore();
  });
});
