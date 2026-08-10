// @vitest-environment jsdom
//
// Scope: the radio *orchestration* in useRadio.ts - guards, the in-flight lock, exclusion-set
// assembly, session memory, the repetition decay, the same-album branch and the two auto-advance
// sites. Candidate scoring itself (`src/lib/radio.ts`: canon-tree ancestor weights,
// CANDIDATE_LIMIT, the per-mode queries) is mocked out here and is a separate scope.
//
// Regressions pinned: known-issues "A 'the thing just finished' test built only from state that
// restore also produces fires at startup" (hasPlayedRef, ANDed into *both* wasAtEnd sites, and
// subscribed rather than selected so play/pause does not re-render the effect).
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/radio", () => ({ getRadioCandidates: vi.fn() }));
vi.mock("../lib/lastfm", () => ({
  fetchSimilarArtistsFull: vi.fn(async () => []),
  fetchSimilarTracks: vi.fn(async () => []),
}));

import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { getDb } from "../db";
import { getRadioCandidates } from "../lib/radio";
import type { RadioCandidate } from "../lib/radio";
import { usePlayerStore, type CurrentTrack } from "../store/player";
import { trackRenders } from "../test/perf";
import { useRadio } from "./useRadio";

const PICK_ID = "srv:pick";

/** The store's own append, captured before any test replaces it with a spy. */
const realAddToQueue = usePlayerStore.getState().addToQueue;

function makeTrack(id: string): CurrentTrack {
  return { id, title: `Track ${id}`, artist: "Artist", duration: 200, albumId: "srv:alb", album: "Album" };
}

function candidatesMock() {
  return getRadioCandidates as unknown as ReturnType<typeof vi.fn>;
}

function candidate(id: string, score: number, artist: string, albumId: string | null): RadioCandidate {
  return { id, title: `Title ${id}`, artist, duration: 180, artworkRef: null, albumId, albumName: "Album", score };
}

/**
 * Serves one candidate list per fill, then empties.
 *
 * `queue` is in the fill effect's deps, so a successful append re-arms the effect: a mock that
 * returns the same non-empty list forever fills until the lookahead is satisfied. Draining to
 * `[]` makes "the Nth fill" a thing a test can talk about.
 */
function serveCandidates(...lists: RadioCandidate[][]) {
  let i = 0;
  candidatesMock().mockImplementation(async () => lists[i++] ?? []);
}

/** Args the hook passed to getRadioCandidates on its Nth (0-based) fill; -1 = the latest. */
function candidateArgs(nth = 0) {
  const calls = candidatesMock().mock.calls;
  return calls[nth < 0 ? calls.length + nth : nth]![0] as {
    seedTrackId: string;
    mode: string;
    excludeIds: Set<string>;
    artistSimilarity: Map<string, number>;
    trackSimilarity: Map<string, number>;
    similarityScale: number;
  };
}

// Boundary mock: the radio fill reads scrobble_history for exclusions, then one row per pick.
// The track row is derived from the bound id so a test can tell *which* candidate was picked.
function mockDb(recentIds: string[] = []) {
  const db = {
    select: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("scrobble_history")) return recentIds.map((id) => ({ track_id: id }));
      const id = String(params?.[0] ?? PICK_ID);
      return [
        {
          id,
          title: `Title ${id}`,
          artist: id === PICK_ID ? "Other" : `Artist ${id}`,
          duration: 180,
          artwork_url: null,
          album_id: `${id}-alb`,
          album_name: "Album 2",
        },
      ];
    }),
    execute: vi.fn(async () => undefined),
  };
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return db;
}

/** A queue of `n` tracks, current index `index`. */
function seedQueue(n: number, index: number) {
  const queue = Array.from({ length: n }, (_, i) => makeTrack(`srv:${i}`));
  usePlayerStore.setState({ queue, queueIndex: index, currentTrack: queue[index] ?? queue[0] });
  return queue;
}

describe("useRadio auto-advance", () => {
  let playFromQueueIndex: ReturnType<typeof vi.fn>;
  let addToQueue: ReturnType<typeof vi.fn>;

  // No `globals: true` in vitest.config.ts, so RTL's auto-cleanup is not registered: without
  // this, a hook left mounted by one test keeps filling the queue during the next one.
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb();
    serveCandidates([candidate(PICK_ID, 1, "Other", "srv:alb2")]);

    playFromQueueIndex = vi.fn(async () => {});
    addToQueue = vi.fn((track: CurrentTrack) => {
      usePlayerStore.setState((s) => ({ queue: [...s.queue, track] }));
    });

    // A queue restored at startup: radio was on when the app last quit, the queue sits on
    // its last entry, and nothing has played since launch.
    usePlayerStore.setState({
      radioActive: true,
      radioMode: "same-genre",
      radioSimilarityScale: 0.5,
      maxQueueSize: 100,
      isShuffled: false,
      shuffleOrder: [],
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
    usePlayerStore.setState({ radioActive: false });
    const { rerender } = renderHook(() => useRadio());

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    act(() => {
      usePlayerStore.setState({ isPlaying: false, radioActive: true });
    });
    rerender();

    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
    expect(playFromQueueIndex).toHaveBeenCalledTimes(1);
  });

  it("does not start playback when playback resumed while the fill was in flight", async () => {
    // The closure holds isPlaying=false from before the awaits; live state says otherwise.
    let release!: (c: RadioCandidate[]) => void;
    candidatesMock().mockImplementation(
      () => new Promise<RadioCandidate[]>((resolve) => { release = resolve; })
    );

    renderHook(() => useRadio());
    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    act(() => {
      usePlayerStore.setState({ isPlaying: false });
    });
    // Effect deps do not include isPlaying, so this fill is still the one armed at mount.
    await waitFor(() => expect(candidatesMock()).toHaveBeenCalledTimes(1));

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    await act(async () => {
      release([candidate(PICK_ID, 1, "Other", "srv:alb2")]);
    });

    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
    expect(playFromQueueIndex).not.toHaveBeenCalled();
  });

  it("does not re-render on play/pause changes", () => {
    // "Subscribed rather than selected": the witness must not put isPlaying in the render path,
    // or every tick of play/pause re-runs the whole radio effect.
    const probe = trackRenders(() => useRadio());
    expect(probe.renders).toBe(1);

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    act(() => {
      usePlayerStore.setState({ isPlaying: false });
    });
    act(() => {
      usePlayerStore.setState({ isLoading: true });
    });

    expect(probe.renders).toBe(1);
    probe.unmount();
  });

  describe("fill guards", () => {
    it("does not query candidates while radio is off", async () => {
      usePlayerStore.setState({ radioActive: false });
      renderHook(() => useRadio());

      await Promise.resolve();
      expect(candidatesMock()).toHaveBeenCalledTimes(0);
    });

    it("does not query candidates without a current track", async () => {
      usePlayerStore.setState({ currentTrack: null });
      renderHook(() => useRadio());

      await Promise.resolve();
      expect(candidatesMock()).toHaveBeenCalledTimes(0);
    });

    it("does not fill while the queue still holds the full lookahead", async () => {
      // remaining === LOOKAHEAD_THRESHOLD (10) is the boundary that must not fill.
      seedQueue(10, 0);
      renderHook(() => useRadio());

      await Promise.resolve();
      expect(candidatesMock()).toHaveBeenCalledTimes(0);
    });

    it("fills once the queue drops one below the lookahead", async () => {
      seedQueue(10, 1);
      renderHook(() => useRadio());

      await waitFor(() => expect(candidatesMock()).toHaveBeenCalledTimes(1));
    });

    it("runs one fill at a time while a fill is in flight", async () => {
      const releases: ((c: RadioCandidate[]) => void)[] = [];
      candidatesMock().mockImplementation(
        () => new Promise<RadioCandidate[]>((resolve) => { releases.push(resolve); })
      );

      const { rerender } = renderHook(() => useRadio());
      await waitFor(() => expect(candidatesMock()).toHaveBeenCalledTimes(1));

      // Anything in the effect's deps moving mid-fill re-arms the effect; the lock must hold.
      act(() => {
        usePlayerStore.setState({ currentTrack: makeTrack("srv:9") });
      });
      rerender();
      await act(async () => {
        // Let the re-armed effect get past its own awaits before counting.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(candidatesMock()).toHaveBeenCalledTimes(1);

      await act(async () => {
        for (const release of releases) release([candidate(PICK_ID, 1, "Other", "srv:alb2")]);
      });
      expect(addToQueue).toHaveBeenCalledTimes(1);
    });

    it("clears the in-flight lock when a fill throws so the next fill can run", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      candidatesMock().mockRejectedValueOnce(new Error("boom"));

      const { rerender } = renderHook(() => useRadio());
      await waitFor(() => expect(err).toHaveBeenCalled());
      expect(addToQueue).toHaveBeenCalledTimes(0);

      serveCandidates([candidate(PICK_ID, 1, "Other", "srv:alb2")]);
      act(() => {
        usePlayerStore.setState({ currentTrack: makeTrack("srv:2") });
      });
      rerender();

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      err.mockRestore();
    });
  });

  describe("exclusions", () => {
    it("excludes every track already in the queue", async () => {
      seedQueue(3, 2);
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      expect([...candidateArgs().excludeIds].sort()).toEqual(["srv:0", "srv:1", "srv:2"]);
    });

    it("excludes tracks scrobbled inside the recent window", async () => {
      mockDb(["srv:recent"]);
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      expect(candidateArgs().excludeIds.has("srv:recent")).toBe(true);
    });

    it("scopes the recent-play lookup to the seed track's server and the last hour", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
      const db = mockDb();
      try {
        renderHook(() => useRadio());
        await vi.waitFor(() => expect(candidatesMock().mock.calls.length).toBeGreaterThan(0));

        const call = db.select.mock.calls.find((c) => String(c[0]).includes("scrobble_history"))!;
        const nowS = Math.floor(new Date("2026-08-10T12:00:00Z").getTime() / 1000);
        expect(call[1]).toEqual(["srv:%", nowS - 3600]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps this session's own picks excluded on the next fill", async () => {
      renderHook(() => useRadio());
      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));

      // The append re-arms the effect, so the follow-up fill happens on its own.
      await waitFor(() => expect(candidatesMock().mock.calls.length).toBeGreaterThan(1));
      expect(candidateArgs(1).excludeIds.has(PICK_ID)).toBe(true);
    });

    it("forgets this session's picks when radio is switched off and on again", async () => {
      const { rerender } = renderHook(() => useRadio());
      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(candidatesMock().mock.calls.length).toBeGreaterThan(1));
      const before = candidatesMock().mock.calls.length;

      act(() => {
        usePlayerStore.setState({ radioActive: false });
      });
      rerender();
      act(() => {
        // Fresh queue too, otherwise the pick stays excluded by queue membership rather than
        // by the session memory this test is about.
        usePlayerStore.setState({ radioActive: true, queue: [makeTrack("srv:9")], queueIndex: 0, currentTrack: makeTrack("srv:9") });
      });
      rerender();

      await waitFor(() => expect(candidatesMock().mock.calls.length).toBeGreaterThan(before));
      expect(candidateArgs(-1).excludeIds.has(PICK_ID)).toBe(false);
    });
  });

  describe("repetition decay", () => {
    beforeEach(() => {
      // pickFromTop draws uniformly from the top window; index 0 makes "the pick" mean
      // "the highest-scoring candidate after the penalty".
      vi.spyOn(Math, "random").mockReturnValue(0);
    });

    afterEach(() => {
      vi.mocked(Math.random).mockRestore?.();
    });

    it("ranks a just-played artist below a lower-scoring fresh one", async () => {
      serveCandidates(
        [candidate(PICK_ID, 1, "Other", "srv:alb2")],
        [
          candidate("srv:same-artist", 1, "Other", "srv:alb3"),
          candidate("srv:fresh", 0.5, "Fresh", "srv:alb4"),
        ]
      );
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(2));
      expect(addToQueue.mock.calls[1]![0].id).toBe("srv:fresh");
    });

    it("skips the penalty in same-artist mode", async () => {
      usePlayerStore.setState({ radioMode: "same-artist" });
      serveCandidates(
        [candidate(PICK_ID, 1, "Other", "srv:alb2")],
        [
          candidate("srv:same-artist", 1, "Other", "srv:alb3"),
          candidate("srv:fresh", 0.5, "Fresh", "srv:alb4"),
        ]
      );
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(2));
      expect(addToQueue.mock.calls[1]![0].id).toBe("srv:same-artist");
    });

    it("still appends when every candidate shares the just-played artist", async () => {
      // Soft penalty, not a filter: a thin pool must not starve into a dead end.
      serveCandidates(
        [candidate(PICK_ID, 1, "Other", "srv:alb2")],
        [candidate("srv:same-artist", 1, "Other", "srv:alb2")]
      );
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(2));
      expect(addToQueue.mock.calls[1]![0].id).toBe("srv:same-artist");
    });
  });

  describe("same-album mode", () => {
    beforeEach(() => {
      usePlayerStore.setState({ radioMode: "same-album" });
      serveCandidates([
        candidate("srv:track2", 0.1, "Other", "srv:alb"),
        candidate("srv:track3", 0.9, "Other", "srv:alb"),
      ]);
    });

    it("takes the first candidate in album order rather than the highest score", async () => {
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      expect(addToQueue.mock.calls[0]![0].id).toBe("srv:track2");
      expect(random).not.toHaveBeenCalled();
      random.mockRestore();
    });

    it("does not start playback when radio state is restored at startup and nothing ever played", async () => {
      // The witness is ANDed into *both* wasAtEnd sites; this is the same-album copy.
      renderHook(() => useRadio());

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      expect(playFromQueueIndex).not.toHaveBeenCalled();
    });

    it("starts the appended track when the queue ran out after playing", async () => {
      usePlayerStore.setState({ radioActive: false });
      const { rerender } = renderHook(() => useRadio());

      act(() => {
        usePlayerStore.setState({ isPlaying: true });
      });
      act(() => {
        usePlayerStore.setState({ isPlaying: false, radioActive: true });
      });
      rerender();

      await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
      expect(playFromQueueIndex).toHaveBeenCalledTimes(1);
    });
  });

  it("starts the appended track at its post-trim index when the append trims the queue", async () => {
    // The real append drops played entries off the front once the queue passes maxQueueSize,
    // so the pre-append length is not the new track's position any more.
    usePlayerStore.setState({
      radioActive: false,
      maxQueueSize: 3,
      addToQueue: realAddToQueue,
    });
    const { rerender } = renderHook(() => useRadio());

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    const queue = [makeTrack("srv:a"), makeTrack("srv:b"), makeTrack("srv:c")];
    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        radioActive: true,
        queue,
        queueIndex: 2,
        currentTrack: queue[2],
      });
    });
    rerender();

    await waitFor(() => expect(playFromQueueIndex).toHaveBeenCalled());
    expect(usePlayerStore.getState().queue.length).toBe(3);
    expect(playFromQueueIndex).toHaveBeenCalledWith(2);
    expect(usePlayerStore.getState().queue[2]!.id).toBe(PICK_ID);
  });
});
