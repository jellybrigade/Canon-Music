// @vitest-environment jsdom
/**
 * Waste tests for the player store: not "is the value right" but "how much did that cost".
 *
 * The elapsed ticker polls at 5Hz for the whole length of every track, so it is the single
 * loudest source of state churn in the app. Everything downstream of it has to stay indifferent
 * to it, and there has to be exactly one of it. Neither property is visible to a correctness
 * test - a store that notifies every subscriber five times a second still reports the right
 * `currentTrack`, and two overlapping intervals still produce a plausible `elapsed`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { resetTauriMocks, onInvoke } from "../test/mocks/tauri";
import { trackRenders, invokeCount } from "../test/perf";
import { getDb } from "../db";
import { usePlayerStore, type CurrentTrack } from "./player";

function mockDb() {
  const db = { select: vi.fn(async () => []), execute: vi.fn(async () => undefined) };
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return db;
}

function makeTrack(id: string): CurrentTrack {
  return { id, title: `Track ${id}`, artist: "Artist", duration: 200 };
}

const streamUrlFor = (t: CurrentTrack) => `http://test/${t.id}`;

function resetStore() {
  usePlayerStore.setState({
    queue: [],
    queueIndex: 0,
    shuffleOrder: [],
    isShuffled: false,
    streamUrlFor,
    currentTrack: null,
    streamUrl: null,
    elapsed: 0,
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

/** Position advances by the real tick interval so no two polls report the same value. */
function tickingPosition() {
  let pos = 0;
  onInvoke("audio_get_pos", () => {
    pos += 0.2;
    return pos;
  });
}

beforeEach(() => {
  resetTauriMocks();
  vi.useFakeTimers();
  resetStore();
  mockDb();
  onInvoke("audio_play", () => undefined);
  tickingPosition();
});

afterEach(() => {
  usePlayerStore.getState().stop();
  vi.useRealTimers();
});

/** Runs `ms` of ticker time, draining the promise each poll awaits. */
async function runClock(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("player store - waste", () => {
  it("a second of elapsed ticks does not re-render a subscriber that only reads currentTrack", async () => {
    await usePlayerStore.getState().playQueue([makeTrack("a"), makeTrack("b")], streamUrlFor, 0);
    await vi.advanceTimersByTimeAsync(0);

    const probe = trackRenders(() => usePlayerStore((s) => s.currentTrack));
    const atMount = probe.renders;

    await runClock(1000);

    // The ticker fired (this is a real 5Hz poll, not a no-op test)...
    expect(usePlayerStore.getState().elapsed).toBeGreaterThan(0);
    // ...and cost the subscriber nothing, because `elapsed` is not what it selects.
    expect(probe.renders).toBe(atMount);
    probe.unmount();
  });

  it("a subscriber that reads elapsed renders once per tick, not more", async () => {
    await usePlayerStore.getState().playQueue([makeTrack("a")], streamUrlFor, 0);
    await vi.advanceTimersByTimeAsync(0);

    const probe = trackRenders(() => usePlayerStore((s) => s.elapsed));
    const atMount = probe.renders;

    await runClock(1000);

    // 200ms interval over 1000ms. An exact count, because "more than zero" would pass just
    // as happily on a duplicated interval writing the same value twice per tick.
    expect(probe.renders - atMount).toBe(5);
    probe.unmount();
  });

  it("restarting playback leaves one poll loop running, not two", async () => {
    await usePlayerStore.getState().playQueue([makeTrack("a")], streamUrlFor, 0);
    await vi.advanceTimersByTimeAsync(0);

    // resume() arms the ticker without stopping it first, and it is reachable while already
    // playing: an MPRIS or media-key "Play" does not check whether playback is under way. Each
    // extra interval doubles the poll rate, the stall checks and the 80% gapless hand-off for
    // the rest of the session, so the guard inside startElapsedTimer is load-bearing.
    usePlayerStore.getState().resume();
    usePlayerStore.getState().resume();
    await vi.advanceTimersByTimeAsync(0);

    const before = invokeCount("audio_get_pos");
    await runClock(1000);
    expect(invokeCount("audio_get_pos") - before).toBe(5);
  });

  it("queuing a 30 track album streams one track, not thirty", async () => {
    const tracks = Array.from({ length: 30 }, (_, i) => makeTrack(String(i)));
    await usePlayerStore.getState().playQueue(tracks, streamUrlFor, 0);
    await vi.advanceTimersByTimeAsync(0);

    // Nothing but the track being listened to is fetched at queue time. The next one is warmed
    // by the ticker at 80%, which this test deliberately never reaches.
    expect(invokeCount("audio_play")).toBe(1);
  });
});
