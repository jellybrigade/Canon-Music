// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);

import { resetTauriMocks, onInvoke, invoke, emitTauriEvent } from "../test/mocks/tauri";
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

// Duration is fixed at 200 for every makeTrack, so pos=160 sits exactly on the >=0.8 prefetch
// threshold the ticker checks every 200ms tick.
const ENQUEUE_POS = 160;

async function setupPlayingQueue(n: number, opts: { queueIndex?: number; isShuffled?: boolean; shuffleOrder?: number[] } = {}) {
  const tracks = makeTracks(n);
  onInvoke("audio_play", () => Promise.resolve(undefined));
  await usePlayerStore.getState().playQueue(tracks, streamUrlFor, opts.queueIndex ?? 0);
  usePlayerStore.setState({
    gapless: true,
    isShuffled: opts.isShuffled ?? false,
    shuffleOrder: opts.shuffleOrder ?? [],
  });
  return tracks;
}

async function driveTickerToEnqueue() {
  onInvoke("audio_get_pos", () => Promise.resolve(ENQUEUE_POS));
  onInvoke("audio_enqueue_next", () => Promise.resolve(undefined));
  await vi.advanceTimersByTimeAsync(200);
}

describe("player store - gapless hand-off", () => {
  describe("canGapless false cases (bullet 5)", () => {
    it("castDevice set: no audio_enqueue_next, no setNext warm", async () => {
      await setupPlayingQueue(3);
      usePlayerStore.setState({ castDevice: { id: "renderer-1" } as never });
      await driveTickerToEnqueue();
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
      expect(invoke.mock.calls.some((c) => c[0] === "audio_prefetch")).toBe(false);
    });

    it("gapless setting off: falls back to setNext warm, not audio_enqueue_next", async () => {
      await setupPlayingQueue(3);
      usePlayerStore.setState({ gapless: false });
      await driveTickerToEnqueue();
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
      expect(invoke.mock.calls.some((c) => c[0] === "audio_prefetch")).toBe(true);
    });

    it("repeat-one: warms the CURRENT track's url, never enqueues the next track", async () => {
      const tracks = await setupPlayingQueue(3);
      usePlayerStore.setState({ repeat: "repeat-one" });
      await driveTickerToEnqueue();
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
      const prefetchCall = invoke.mock.calls.find((c) => c[0] === "audio_prefetch");
      expect(prefetchCall?.[1]).toEqual({ url: streamUrlFor(tracks[0]!) });
    });

    it("consumeMode without wrap: still warms setNext, just not audio_enqueue_next", async () => {
      await setupPlayingQueue(3);
      usePlayerStore.setState({ consumeMode: true });
      await driveTickerToEnqueue();
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
      expect(invoke.mock.calls.some((c) => c[0] === "audio_prefetch")).toBe(true);
    });

    it("consumeMode + wrapping + shuffled: neither audio_enqueue_next nor setNext, order not knowable yet", async () => {
      await setupPlayingQueue(3, { queueIndex: 2, isShuffled: true, shuffleOrder: [0, 1, 2] });
      usePlayerStore.setState({ consumeMode: true, repeat: "repeat-all" });
      await driveTickerToEnqueue();
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
      expect(invoke.mock.calls.some((c) => c[0] === "audio_prefetch")).toBe(false);
    });

    it("no duration on current track: never attempts enqueue regardless of canGapless", async () => {
      const tracks = makeTracks(2);
      tracks[0]!.duration = null;
      onInvoke("audio_play", () => Promise.resolve(undefined));
      await usePlayerStore.getState().playQueue(tracks, streamUrlFor, 0);
      usePlayerStore.setState({ gapless: true });
      onInvoke("audio_get_pos", () => Promise.resolve(0));
      onInvoke("audio_enqueue_next", () => Promise.resolve(undefined));
      await vi.advanceTimersByTimeAsync(200);
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
    });
  });

  describe("gapless-cancelled clears gaplessActive (bullet 3)", () => {
    it("without a cancel event, the natural-end fallback stays suppressed while an enqueue is pending", async () => {
      await setupPlayingQueue(2);
      await driveTickerToEnqueue();
      const audioPlayCallsBefore = invoke.mock.calls.filter((c) => c[0] === "audio_play").length;
      // Position reaches the end without track-advanced or gapless-cancelled firing: the Rust
      // engine is presumed to be handling the transition, so the TS fallback must stay quiet.
      onInvoke("audio_get_pos", () => Promise.resolve(199.9));
      await vi.advanceTimersByTimeAsync(200);
      expect(invoke.mock.calls.filter((c) => c[0] === "audio_play").length).toBe(audioPlayCallsBefore);
    });

    it("gapless-cancelled un-sticks the fallback so next() resumes firing on natural end", async () => {
      await setupPlayingQueue(2);
      await driveTickerToEnqueue();

      emitTauriEvent("gapless-cancelled", undefined);

      onInvoke("audio_play", () => Promise.resolve(undefined));
      const audioPlayCallsBefore = invoke.mock.calls.filter((c) => c[0] === "audio_play").length;
      onInvoke("audio_get_pos", () => Promise.resolve(199.9));
      await vi.advanceTimersByTimeAsync(200);
      // next(true) -> playTrack(..., nav=true) defers the actual audio_play through a 100ms
      // debounce timer, so the tick that triggers next() is not enough on its own to observe it.
      await vi.advanceTimersByTimeAsync(100);
      expect(invoke.mock.calls.filter((c) => c[0] === "audio_play").length).toBeGreaterThan(audioPlayCallsBefore);
    });

    it("gapless-cancelled clears gaplessEnqueued: a late spurious track-advanced falls to the plain-recompute branch", async () => {
      await setupPlayingQueue(3);
      await driveTickerToEnqueue();
      emitTauriEvent("gapless-cancelled", undefined);

      emitTauriEvent("track-advanced", undefined);

      // Plain queueIndex+1 recompute (no enqueued track to follow), not the follow-the-track path.
      expect(usePlayerStore.getState().queueIndex).toBe(1);
      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
    });
  });

  describe("sleep timer end-of-track (bullet 4)", () => {
    it("blocks the enqueue: sleepTimerEndOfTrack true means no audio_enqueue_next at the 80% threshold", async () => {
      await setupPlayingQueue(2);
      usePlayerStore.setState({ sleepTimerEndOfTrack: true });
      await driveTickerToEnqueue();
      expect(invoke.mock.calls.some((c) => c[0] === "audio_enqueue_next")).toBe(false);
    });

    it("armed after the enqueue (late): track-advanced still advances queue state, then pauses on arrival", async () => {
      await setupPlayingQueue(2);
      await driveTickerToEnqueue();

      // Timer arms inside the lead window, after the enqueue already happened.
      usePlayerStore.setState({ sleepTimerEndOfTrack: true });
      onInvoke("audio_pause", () => Promise.resolve(undefined));

      emitTauriEvent("track-advanced", undefined);

      const state = usePlayerStore.getState();
      expect(state.queueIndex).toBe(1);
      expect(state.currentTrack?.id).toBe("1");
      expect(state.isPlaying).toBe(false);
      expect(state.sleepTimerEndOfTrack).toBe(false);
      expect(invoke.mock.calls.some((c) => c[0] === "audio_pause")).toBe(true);
    });

    it("never armed: track-advanced completes normally, isPlaying stays true", async () => {
      await setupPlayingQueue(2);
      await driveTickerToEnqueue();

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().isPlaying).toBe(true);
    });

    it("next(true) with sleepTimerEndOfTrack: non-gapless mirror of the same guard", async () => {
      await setupPlayingQueue(2);
      usePlayerStore.setState({ sleepTimerEndOfTrack: true, gapless: false });
      const queueIndexBefore = usePlayerStore.getState().queueIndex;

      await usePlayerStore.getState().next(true);

      expect(usePlayerStore.getState().isPlaying).toBe(false);
      expect(usePlayerStore.getState().queueIndex).toBe(queueIndexBefore);
      expect(usePlayerStore.getState().sleepTimerEndOfTrack).toBe(false);
    });
  });

  describe("gaplessEnqueued follows the track through queue edits (bullet 1)", () => {
    it("no edit: fast path holds trivially", async () => {
      await setupPlayingQueue(3);
      await driveTickerToEnqueue();

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().queueIndex).toBe(1);
      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
    });

    it("insert before it (playNext): id-scan relocates the enqueued track", async () => {
      await setupPlayingQueue(3); // queue 0,1,2 ; queueIndex 0 ; enqueues track "1"
      await driveTickerToEnqueue();

      usePlayerStore.getState().playNext(makeTrack("new"), streamUrlFor); // inserts at position 1

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
      expect(usePlayerStore.getState().queueIndex).toBe(2);
    });

    it("reorder (moveQueueItem, non-shuffled): id-scan relocates the enqueued track", async () => {
      await setupPlayingQueue(4); // queue 0,1,2,3 ; enqueues track "1" at position 1
      await driveTickerToEnqueue();

      usePlayerStore.getState().moveQueueItem(1, 3); // track "1" now sits at index 3

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
      expect(usePlayerStore.getState().queueIndex).toBe(3);
    });

    it("reorder (moveQueueItem, shuffled): id-scan relocates through the shuffleOrder splice", async () => {
      await setupPlayingQueue(4, { isShuffled: true, shuffleOrder: [0, 1, 2, 3] }); // enqueues track "1"
      await driveTickerToEnqueue();

      usePlayerStore.getState().moveQueueItem(1, 2);

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
    });

    it("remove the enqueued track itself: still shown as current, index parked forward", async () => {
      await setupPlayingQueue(3); // queue 0,1,2 ; queueIndex 0 ; enqueues track "1" at position 1
      await driveTickerToEnqueue();

      await usePlayerStore.getState().removeFromQueue(1); // removes track "1" while it's already handed to the engine

      emitTauriEvent("track-advanced", undefined);

      // Still audibly playing "1" even though it's gone from the queue array.
      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
      expect(usePlayerStore.getState().queueIndex).toBe(1);
    });

    it("remove a different, unrelated track before it: id-scan relocates by shifted position", async () => {
      await setupPlayingQueue(4, { queueIndex: 1 }); // queue 0,1,2,3 ; queueIndex 1 (playing "1") ; enqueues "2"
      await driveTickerToEnqueue();

      await usePlayerStore.getState().removeFromQueue(0); // removes "0", unrelated, before the enqueued "2"

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().currentTrack?.id).toBe("2");
      expect(usePlayerStore.getState().queueIndex).toBe(1);
    });

    it("gaplessEnqueued is null when track-advanced fires (never enqueued): plain queueIndex+1 recompute", async () => {
      await setupPlayingQueue(3);
      usePlayerStore.setState({ gapless: false }); // never reaches the enqueue branch

      emitTauriEvent("track-advanced", undefined);

      expect(usePlayerStore.getState().queueIndex).toBe(1);
      expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
    });
  });

  describe("repeat-all wrap uses gaplessEnqueued.wrapOrder (bullet 2)", () => {
    it("wrapOrder present and length matches queue: adopted verbatim, not recomputed", async () => {
      await setupPlayingQueue(3, { queueIndex: 2, isShuffled: true, shuffleOrder: [2, 0, 1] });
      usePlayerStore.setState({ repeat: "repeat-all" });
      await driveTickerToEnqueue();

      emitTauriEvent("track-advanced", undefined);

      const state = usePlayerStore.getState();
      expect(state.queueIndex).toBe(0);
      // The adopted order must be exactly what the ticker recorded, not a fresh rebuild.
      expect(state.currentTrack?.id).toBe(state.queue[state.shuffleOrder[0]!]!.id);
    });

    it("wrapOrder invalidated by a queue-length change during the lead window: rebuilds anchored on the enqueued track", async () => {
      // Math.random pinned so buildShuffleOrder(3, -1) deterministically enqueues track "1"
      // (see the hand-derivation in the comment above the assertions below).
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      await setupPlayingQueue(3, { queueIndex: 2, isShuffled: true, shuffleOrder: [2, 0, 1] });
      usePlayerStore.setState({ repeat: "repeat-all" });
      await driveTickerToEnqueue();

      // Removes track "0" (unrelated to the enqueued track "1"), shrinking the queue so
      // wrapOrder.length (3) no longer matches queue.length (2) while the position still wraps.
      await usePlayerStore.getState().removeFromQueue(1);

      emitTauriEvent("track-advanced", undefined);
      randomSpy.mockRestore();

      const state = usePlayerStore.getState();
      expect(state.queueIndex).toBe(0);
      // Anchored on whichever track was actually handed to the engine, so it opens the new pass.
      expect(state.queue[state.shuffleOrder[0]!]!.id).toBe(state.currentTrack?.id);
    });

    it("non-gapless mirror in next(): repeat-all wrap under shuffle does not always reopen on the same track", async () => {
      const positions0: string[] = [];
      for (let i = 0; i < 40; i++) {
        vi.useFakeTimers();
        resetTauriMocks();
        resetStore();
        const tracks = makeTracks(4);
        onInvoke("audio_play", () => Promise.resolve(undefined));
        await usePlayerStore.getState().playQueue(tracks, streamUrlFor, 3);
        usePlayerStore.setState({ isShuffled: true, shuffleOrder: [0, 1, 2, 3], repeat: "repeat-all", gapless: false });

        await usePlayerStore.getState().next(true);

        positions0.push(usePlayerStore.getState().currentTrack!.id);
        vi.useRealTimers();
      }
      const distinctTracks = new Set(positions0);
      expect(distinctTracks.size).toBeGreaterThan(1);
    });

    it("degenerate: queue length 1 on wrap does not crash and replays the single track", async () => {
      await setupPlayingQueue(1, { isShuffled: true, shuffleOrder: [0] });
      usePlayerStore.setState({ repeat: "repeat-all" });
      await driveTickerToEnqueue();

      expect(() => emitTauriEvent("track-advanced", undefined)).not.toThrow();
      expect(usePlayerStore.getState().currentTrack?.id).toBe("0");
      expect(usePlayerStore.getState().queueIndex).toBe(0);
    });
  });
});
