// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/radio", () => ({ getRadioCandidates: vi.fn() }));
vi.mock("../lib/lastfm", () => ({
  fetchSimilarArtistsFull: vi.fn(async () => []),
  fetchSimilarTracks: vi.fn(async () => []),
}));

import { renderHook, waitFor, act } from "@testing-library/react";
import { getDb } from "../db";
import { getRadioCandidates } from "../lib/radio";
import { usePlayerStore, type CurrentTrack } from "../store/player";
import { useRadio } from "./useRadio";

const PICK_ID = "srv:pick";

function makeTrack(id: string): CurrentTrack {
  return { id, title: `Track ${id}`, artist: "Artist", duration: 200, albumId: "srv:alb", album: "Album" };
}

// Boundary mock: the radio fill reads scrobble_history for exclusions, then one row for the pick.
function mockDb() {
  const db = {
    select: vi.fn(async (sql: string) => {
      if (sql.includes("scrobble_history")) return [];
      return [
        {
          id: PICK_ID,
          title: "Picked",
          artist: "Other",
          duration: 180,
          artwork_url: null,
          album_id: "srv:alb2",
          album_name: "Album 2",
        },
      ];
    }),
    execute: vi.fn(async () => undefined),
  };
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return db;
}

describe("useRadio auto-advance", () => {
  let playFromQueueIndex: ReturnType<typeof vi.fn>;
  let addToQueue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb();
    (getRadioCandidates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: PICK_ID, score: 1, artist: "Other", albumId: "srv:alb2" },
    ]);

    playFromQueueIndex = vi.fn(async () => {});
    addToQueue = vi.fn((track: CurrentTrack) => {
      usePlayerStore.setState((s) => ({ queue: [...s.queue, track] }));
    });

    // A queue restored at startup: radio was on when the app last quit, the queue sits on
    // its last entry, and nothing has played since launch.
    usePlayerStore.setState({
      radioActive: true,
      radioMode: "same-genre",
      queue: [makeTrack("srv:1")],
      queueIndex: 0,
      currentTrack: makeTrack("srv:1"),
      isPlaying: false,
      isLoading: false,
      streamUrlFor: () => "http://stream",
      playFromQueueIndex: playFromQueueIndex as unknown as (i: number) => Promise<void>,
      addToQueue: addToQueue as unknown as (t: CurrentTrack, f: (t: CurrentTrack) => string) => void,
    });
  });

  it("does not start playback when radio state is restored at startup and nothing ever played", async () => {
    renderHook(() => useRadio());

    await waitFor(() => expect(addToQueue).toHaveBeenCalled());
    expect(playFromQueueIndex).not.toHaveBeenCalled();
  });

  it("starts the appended track when the queue ran out after playing", async () => {
    // Playback happened this session and then stopped at the end of the queue: this is the
    // case the auto-advance exists for.
    const { rerender } = renderHook(() => useRadio());
    await waitFor(() => expect(addToQueue).toHaveBeenCalled());
    addToQueue.mockClear();

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        queueIndex: usePlayerStore.getState().queue.length - 1,
        currentTrack: makeTrack("srv:2"),
      });
    });
    rerender();

    await waitFor(() => expect(playFromQueueIndex).toHaveBeenCalled());
  });
});
