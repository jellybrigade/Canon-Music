// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/bandsintown", () => ({ fetchBandsintownEvents: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { type BandsintownEvent, fetchBandsintownEvents } from "../../../clients/bandsintown";
import { useTourEvents } from "./useTourEvents";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function event(venueName: string): BandsintownEvent {
  return { datetime: "", venueName, venueCity: "", venueRegion: "", venueCountry: "", url: "", lineup: [] };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.mocked(fetchBandsintownEvents).mockReset();
});

describe("useTourEvents", () => {
  it("shows none of the previous artist's dates while the next artist's load", async () => {
    vi.mocked(fetchBandsintownEvents).mockImplementation(async (name) =>
      name === "Slowdive" ? [event("Roundhouse")] : new Promise<BandsintownEvent[]>(() => {}),
    );
    const { result, rerender } = renderHook(({ artistName }) => useTourEvents(artistName, true), {
      wrapper,
      initialProps: { artistName: "Slowdive" },
    });
    await waitFor(() => expect(result.current.events.map((e) => e.venueName)).toEqual(["Roundhouse"]));

    rerender({ artistName: "Ride" });

    expect(result.current.events).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("shows none of the previous artist's dates when the next artist's fail to load", async () => {
    vi.mocked(fetchBandsintownEvents).mockImplementation(async (name) => {
      if (name === "Slowdive") return [event("Roundhouse")];
      throw new Error("Bandsintown returned 503");
    });
    const { result, rerender } = renderHook(({ artistName }) => useTourEvents(artistName, true), {
      wrapper,
      initialProps: { artistName: "Slowdive" },
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ artistName: "Ride" });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events).toEqual([]);
  });

  it("asks Bandsintown nothing while tour dates are off", () => {
    const { result } = renderHook(() => useTourEvents("Slowdive", false), { wrapper });

    expect(fetchBandsintownEvents).not.toHaveBeenCalled();
    expect(result.current).toEqual({ events: [], isLoading: false });
  });
});
