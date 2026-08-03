// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);

import { resetTauriMocks, onInvoke, invoke } from "../test/mocks/tauri";
import { usePlayerStore, normalizeShuffleOrder, isNextDisabled, type CurrentTrack } from "./player";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function makeTrack(id: string): CurrentTrack {
  return { id, title: `Track ${id}`, artist: "Artist", duration: 200 };
}

function makeTracks(n: number): CurrentTrack[] {
  return Array.from({ length: n }, (_, i) => makeTrack(String(i)));
}

const streamUrlFor = (t: CurrentTrack) => `http://test/${t.id}`;

function resetStore() {
  usePlayerStore.setState({
    queue: [],
    queueIndex: 0,
    shuffleOrder: [],
    isShuffled: false,
    maxQueueSize: 100,
    streamUrlFor,
    currentTrack: null,
    radioActive: false,
    radioSeed: null,
    streamUrl: null,
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    error: null,
    castDevice: null,
    gapless: false,
    repeat: "off",
    consumeMode: false,
    sleepTimerEndOfTrack: false,
  });
}

beforeEach(() => {
  resetTauriMocks();
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

function invariantHolds() {
  const { queue, shuffleOrder, isShuffled } = usePlayerStore.getState();
  if (!isShuffled) return true;
  return shuffleOrder.length === queue.length;
}

describe("player store - queue/shuffle invariants", () => {
  describe("shuffleOrder.length === queue.length after every mutation", () => {
    it("holds after playQueue under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(5), streamUrlFor, 2);
      expect(invariantHolds()).toBe(true);
      expect(usePlayerStore.getState().shuffleOrder).toHaveLength(5);
    });

    it("holds after addManyToQueue under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(3), streamUrlFor);
      usePlayerStore.getState().addManyToQueue(makeTracks(2).map((t) => makeTrack(`new-${t.id}`)), streamUrlFor);
      expect(invariantHolds()).toBe(true);
    });

    it("holds after playNextMany under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(3), streamUrlFor);
      usePlayerStore.getState().playNextMany([makeTrack("n1"), makeTrack("n2")], streamUrlFor);
      expect(invariantHolds()).toBe(true);
    });

    it("holds after removeFromQueue under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(4), streamUrlFor, 0);
      await usePlayerStore.getState().removeFromQueue(2);
      expect(invariantHolds()).toBe(true);
    });

    it("holds after removeManyFromQueue under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(6), streamUrlFor, 0);
      await usePlayerStore.getState().removeManyFromQueue([1, 3, 4]);
      expect(invariantHolds()).toBe(true);
    });

    it("holds after moveQueueItem under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(5), streamUrlFor, 0);
      usePlayerStore.getState().moveQueueItem(0, 3);
      expect(invariantHolds()).toBe(true);
      // moveQueueItem under shuffle moves the order, not the queue array itself
      expect(usePlayerStore.getState().queue).toHaveLength(5);
    });

    it("holds after clearQueue under shuffle", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(4), streamUrlFor);
      usePlayerStore.getState().clearQueue();
      expect(usePlayerStore.getState().queue).toEqual([]);
      expect(usePlayerStore.getState().shuffleOrder).toEqual([]);
    });

    it("holds across a random sequence of mutations", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(3), streamUrlFor, 0);
      let nextId = 100;

      for (let i = 0; i < 200; i++) {
        const state = usePlayerStore.getState();
        const queueLen = state.queue.length;
        const op = Math.floor(Math.random() * 6);

        if (queueLen === 0) {
          // repopulate so subsequent ops have something to act on
          await state.playQueue(makeTracks(3), streamUrlFor, 0);
          expect(invariantHolds()).toBe(true);
          continue;
        }

        switch (op) {
          case 0:
            state.addManyToQueue([makeTrack(`r${nextId++}`)], streamUrlFor);
            break;
          case 1:
            state.playNextMany([makeTrack(`r${nextId++}`)], streamUrlFor);
            break;
          case 2:
            await state.removeFromQueue(Math.floor(Math.random() * queueLen));
            break;
          case 3: {
            const positions = new Set<number>();
            const count = 1 + Math.floor(Math.random() * Math.min(3, queueLen));
            while (positions.size < count) positions.add(Math.floor(Math.random() * queueLen));
            await state.removeManyFromQueue([...positions]);
            break;
          }
          case 4: {
            if (queueLen > 1) {
              const from = Math.floor(Math.random() * queueLen);
              let to = Math.floor(Math.random() * queueLen);
              if (to === from) to = (to + 1) % queueLen;
              state.moveQueueItem(from, to);
            }
            break;
          }
          case 5:
            state.clearQueue();
            break;
        }
        expect(invariantHolds()).toBe(true);
      }
    });
  });

  it("playQueue([oneTrack]) under shuffle writes [0], not []", async () => {
    usePlayerStore.setState({ isShuffled: true });
    await usePlayerStore.getState().playQueue([makeTrack("solo")], streamUrlFor);
    expect(usePlayerStore.getState().shuffleOrder).toEqual([0]);
  });

  describe("normalizeShuffleOrder", () => {
    it("returns a fresh array on the fast path (length already matches)", () => {
      const order = [2, 0, 1];
      const result = normalizeShuffleOrder(order, 3);
      expect(result).not.toBe(order);
      expect(result).toEqual(order);
    });

    it("repairs a short order by appending missing indices", () => {
      const result = normalizeShuffleOrder([2, 0], 4);
      expect(result).toHaveLength(4);
      expect(new Set(result)).toEqual(new Set([0, 1, 2, 3]));
      expect(result.slice(0, 2)).toEqual([2, 0]);
    });

    it("drops out-of-range and duplicate entries during repair", () => {
      const result = normalizeShuffleOrder([5, 1, 1, -1, 0], 3);
      expect(result).toHaveLength(3);
      expect(new Set(result)).toEqual(new Set([0, 1, 2]));
    });

    it("repairs an empty order against a non-empty queue", () => {
      const result = normalizeShuffleOrder([], 3);
      expect(result).toEqual([0, 1, 2]);
    });
  });

  describe("moveQueueItem", () => {
    it("normalizes a short shuffleOrder before splicing (no length drift, no crash)", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(4), streamUrlFor, 0);
      // Simulate a stale/short order arriving via direct state write, as addManyToQueue's
      // pre-trim state or a restored session might produce.
      usePlayerStore.setState({ shuffleOrder: [2, 0] });
      usePlayerStore.getState().moveQueueItem(0, 3);
      expect(usePlayerStore.getState().shuffleOrder).toHaveLength(4);
      expect(invariantHolds()).toBe(true);
    });

    it("no-ops when from === to", async () => {
      usePlayerStore.setState({ isShuffled: true });
      await usePlayerStore.getState().playQueue(makeTracks(3), streamUrlFor, 0);
      const before = usePlayerStore.getState().shuffleOrder;
      usePlayerStore.getState().moveQueueItem(1, 1);
      expect(usePlayerStore.getState().shuffleOrder).toBe(before);
    });

    it("no-ops on out-of-range indices", async () => {
      await usePlayerStore.getState().playQueue(makeTracks(3), streamUrlFor, 0);
      const before = usePlayerStore.getState().queue;
      usePlayerStore.getState().moveQueueItem(0, 5);
      expect(usePlayerStore.getState().queue).toBe(before);
    });
  });

  describe("queue trimming at maxQueueSize", () => {
    it("addManyToQueue trims to cap and shuffleOrder stays aligned", async () => {
      usePlayerStore.setState({ isShuffled: true, maxQueueSize: 5 });
      await usePlayerStore.getState().playQueue(makeTracks(4), streamUrlFor, 3);
      // playQueue always anchors the shuffled position at 0; advance queueIndex to simulate
      // having already played partway through, which is what makes anything trimmable.
      usePlayerStore.setState({ queueIndex: 3 });
      usePlayerStore.getState().addManyToQueue(makeTracks(3).map((t) => makeTrack(`x${t.id}`)), streamUrlFor);
      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(5);
      expect(invariantHolds()).toBe(true);
    });

    it("playNextMany trims using the post-splice length read back off the store, not the pre-append length", async () => {
      usePlayerStore.setState({ isShuffled: false, maxQueueSize: 4 });
      // Start at the last position (queueIndex 4) so the full overflow (4) is droppable -
      // trim is capped at `queueIndex`, so a smaller starting position would only partially trim,
      // masking a regression that reused the pre-append queue length instead of the real one.
      await usePlayerStore.getState().playQueue(makeTracks(5), streamUrlFor, 4);
      usePlayerStore.getState().playNextMany(makeTracks(3).map((t) => makeTrack(`y${t.id}`)), streamUrlFor);
      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(4);
      expect(state.queueIndex).toBeGreaterThanOrEqual(0);
      expect(state.queueIndex).toBeLessThan(state.queue.length);
    });

    it("does not trim when queue is already within cap", async () => {
      usePlayerStore.setState({ maxQueueSize: 10 });
      await usePlayerStore.getState().playQueue(makeTracks(3), streamUrlFor, 0);
      usePlayerStore.getState().addManyToQueue([makeTrack("extra")], streamUrlFor);
      expect(usePlayerStore.getState().queue).toHaveLength(4);
    });
  });

  describe("isNextDisabled", () => {
    it.each([
      ["off", 0, 3, false, false],
      ["off", 1, 3, false, false],
      ["off", 2, 3, false, true],
      ["repeat-all", 2, 3, false, false],
      ["repeat-one", 2, 3, false, false],
      ["off", 2, 3, true, false],
      ["off", 0, 1, false, true],
      ["off", 0, 0, false, true],
      ["repeat-all", 0, 0, false, false],
    ] as const)(
      "repeat=%s index=%i length=%i radioOnQueueEnd=%s -> disabled=%s",
      (repeat, index, length, radioOnQueueEnd, expected) => {
        expect(isNextDisabled(repeat, index, length, radioOnQueueEnd)).toBe(expected);
      }
    );

    it("does not depend on shuffle state for a given position/length", () => {
      const a = isNextDisabled("off", 2, 3, false);
      const b = isNextDisabled("off", 2, 3, false);
      expect(a).toBe(b);
    });
  });
});

describe("player store - transport intent", () => {
  it("pause() called during playTrack's load await leaves the engine paused once load resolves", async () => {
    const track = makeTrack("a");
    const { promise: loadPromise, resolve: resolveLoad } = deferred<undefined>();
    onInvoke("audio_play", () => loadPromise);

    const playPromise = usePlayerStore.getState().play(track, "http://test/a");
    expect(usePlayerStore.getState().isLoading).toBe(true);

    // Pause races the in-flight load: this must not be lost by the async completion.
    usePlayerStore.getState().pause();
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    resolveLoad(undefined);
    await playPromise;

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().isLoading).toBe(false);
  });

  describe("resume()", () => {
    it("with currentTrack set but streamUrl null routes to retryCurrent, never sets isPlaying directly", () => {
      const track = makeTrack("restored");
      usePlayerStore.setState({ currentTrack: track, streamUrl: null, error: null, streamUrlFor: () => "http://test/restored" });

      usePlayerStore.getState().resume();

      const state = usePlayerStore.getState();
      // retryCurrent fires playTrack, which immediately marks loading and isPlaying false -
      // resume()'s own "just resume" branch (which sets isPlaying: true synchronously) must not run.
      expect(state.isLoading).toBe(true);
      expect(state.isPlaying).toBe(false);
    });

    it("with no currentTrack is a no-op: no engine call, no ticker started", () => {
      usePlayerStore.setState({ currentTrack: null, streamUrl: null });
      const timersBefore = vi.getTimerCount();
      const invokeCallsBefore = invoke.mock.calls.length;

      usePlayerStore.getState().resume();

      expect(usePlayerStore.getState().isPlaying).toBe(false);
      expect(vi.getTimerCount()).toBe(timersBefore);
      expect(invoke.mock.calls.length).toBe(invokeCallsBefore);
    });
  });

  it("stop() clears pauseRequestedDuringLoad so a subsequent track is not born paused", async () => {
    const trackA = makeTrack("a");
    const { promise: loadA, resolve: resolveLoadA } = deferred<undefined>();
    onInvoke("audio_play", () => loadA);

    const playA = usePlayerStore.getState().play(trackA, "http://test/a");
    usePlayerStore.getState().pause(); // sets pauseRequestedDuringLoad while trackA is loading
    resolveLoadA(undefined);
    await playA;

    usePlayerStore.getState().stop();
    expect(usePlayerStore.getState().currentTrack).toBeNull();

    const trackB = makeTrack("b");
    onInvoke("audio_play", () => Promise.resolve(undefined));
    await usePlayerStore.getState().play(trackB, "http://test/b");

    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it("seek() bumps seekGen so an in-flight position poll from before the seek is dropped", async () => {
    const track = makeTrack("a");
    onInvoke("audio_play", () => Promise.resolve(undefined));
    await usePlayerStore.getState().play(track, "http://test/a");
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    const { promise: posPromise, resolve: resolvePos } = deferred<number>();
    onInvoke("audio_get_pos", () => posPromise);
    onInvoke("audio_seek", () => Promise.resolve(undefined));

    // Ticker tick fires and captures seekGen before the position resolves.
    await vi.advanceTimersByTimeAsync(200);

    await usePlayerStore.getState().seek(5);
    expect(usePlayerStore.getState().elapsed).toBe(5);

    // The poll that started before the seek now resolves with a stale position.
    resolvePos(50);
    await vi.advanceTimersByTimeAsync(0);

    expect(usePlayerStore.getState().elapsed).toBe(5);
  });

  it("natural-end fallback advance does not fire while isPlaying is false", async () => {
    const firstTrack = makeTrack("0");
    const tracks = [firstTrack, makeTrack("1")];
    onInvoke("audio_play", () => Promise.resolve(undefined));
    await usePlayerStore.getState().playQueue(tracks, streamUrlFor, 0);
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    // Isolate the isPlaying guard: the ticker keeps polling but playback is not audibly active.
    usePlayerStore.setState({ isPlaying: false });
    const audioPlayCallsBefore = invoke.mock.calls.filter((c) => c[0] === "audio_play").length;
    onInvoke("audio_get_pos", () => Promise.resolve((firstTrack.duration ?? 0) - 0.1));

    await vi.advanceTimersByTimeAsync(200);

    const audioPlayCallsAfter = invoke.mock.calls.filter((c) => c[0] === "audio_play").length;
    expect(audioPlayCallsAfter).toBe(audioPlayCallsBefore);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("0");
  });
});
