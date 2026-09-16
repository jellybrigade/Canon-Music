// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMissingTracksRepair } from "./useMissingTracksRepair";

interface Props {
  albumId: string;
  tracks: readonly unknown[] | undefined;
  fetchTracks: (albumId: string) => Promise<void>;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(initial: Props) {
  return renderHook(
    ({ albumId, tracks, fetchTracks }: Props) =>
      useMissingTracksRepair({
        albumId,
        tracks,
        isLoading: false,
        error: null,
        fetchTracks: () => fetchTracks(albumId),
      }),
    { initialProps: initial, reactStrictMode: true },
  );
}

describe("useMissingTracksRepair", () => {
  it("stops reporting the fetch as running once it succeeds under StrictMode", async () => {
    const fetch = deferred();
    const { result } = mount({ albumId: "a1", tracks: [], fetchTracks: () => fetch.promise });
    expect(result.current.isFetching).toBe(true);

    await act(async () => fetch.resolve());
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("shows the failure once the fetch rejects under StrictMode", async () => {
    const fetch = deferred();
    const { result } = mount({ albumId: "a1", tracks: [], fetchTracks: () => fetch.promise });

    await act(async () => fetch.reject(new Error("offline")));
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBe("offline");
  });

  it("fetches once per album however many fresh empty lists arrive", () => {
    const fetchTracks = vi.fn(() => new Promise<void>(() => {}));
    const { rerender } = mount({ albumId: "a1", tracks: [], fetchTracks });
    for (let i = 0; i < 5; i++) rerender({ albumId: "a1", tracks: [], fetchTracks });
    expect(fetchTracks).toHaveBeenCalledTimes(1);
  });

  it("keeps the next album's fetch running when the previous album's fetch finishes", async () => {
    const fetches = new Map([["a1", deferred()], ["a2", deferred()]]);
    const fetchTracks = (albumId: string) => fetches.get(albumId)!.promise;
    const { result, rerender } = mount({ albumId: "a1", tracks: [], fetchTracks });
    rerender({ albumId: "a2", tracks: [], fetchTracks });

    await act(async () => fetches.get("a1")!.resolve());
    expect(result.current.isFetching).toBe(true);
  });

  it("does not paint the previous album's failure on the next album", async () => {
    const fetches = new Map([["a1", deferred()], ["a2", deferred()]]);
    const fetchTracks = (albumId: string) => fetches.get(albumId)!.promise;
    const { result, rerender } = mount({ albumId: "a1", tracks: [], fetchTracks });
    rerender({ albumId: "a2", tracks: [], fetchTracks });

    await act(async () => fetches.get("a1")!.reject(new Error("offline")));
    expect(result.current.error).toBeNull();
    expect(result.current.isFetching).toBe(true);
  });

  it("fetches again when the user retries", async () => {
    const fetchTracks = vi.fn(() => Promise.resolve());
    const { result, rerender } = mount({ albumId: "a1", tracks: [], fetchTracks });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    act(() => result.current.retry());
    rerender({ albumId: "a1", tracks: [], fetchTracks });
    expect(fetchTracks).toHaveBeenCalledTimes(2);
  });
});
