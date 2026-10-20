// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { usePlayerStore } from "../features/playback/store/player";
import type { CurrentTrack } from "../features/playback/store/playerTypes";
import { RADIO_START_ACTION_SETTING } from "../features/radio/hooks/useStartRadio";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { usePaletteActions } from "./usePaletteActions";
import type { ServerWithCredential } from "./useServer";
import { __resetSettingCache } from "./useSetting";

const SRV: ServerWithCredential = {
  server: { id: "srv", type: "navidrome", url: "https://music.example", username: "u" },
  credential: { type: "md5", token: "tok", salt: "salt" },
} as ServerWithCredential;

const track: CurrentTrack = { id: "t1", title: "Song", artist: null, duration: 100 };

let db: FakeDatabase;
const runSync = vi.fn(() => true);
const pause = vi.fn();
const resume = vi.fn();
const setSleepTimer = vi.fn();
const startRadioFrom = vi.fn(() => Promise.resolve());

function labels(actions: { label: string }[]) {
  return actions.map((action) => action.label);
}

async function mountLoaded({ server }: { server: ServerWithCredential | undefined } = { server: SRV }) {
  let renders = 0;
  const hook = renderHook(() => {
    renders++;
    return usePaletteActions(server, runSync);
  });
  // The radio start setting is read once; let it land before the case acts.
  await waitFor(() => expect(db.selectCount).toBe(1));
  await act(async () => {});
  return { ...hook, renders: () => renders };
}

function run(actions: { label: string; run: () => void }[], label: string) {
  const action = actions.find((candidate) => candidate.label === label);
  if (!action) throw new Error(`no action "${label}" in ${labels(actions).join(", ")}`);
  act(() => action.run());
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  db.raw.prepare("INSERT INTO settings (key, value) VALUES (?, 'replace')").run(RADIO_START_ACTION_SETTING);
  for (const mock of [runSync, pause, resume, setSleepTimer, startRadioFrom]) mock.mockClear();
  usePlayerStore.setState({
    currentTrack: track,
    streamUrlFor: (t) => t.id,
    isPlaying: true,
    isLoading: false,
    radioActive: false,
    queue: [track, track],
    queueIndex: 0,
    repeat: "off",
    radioOnQueueEnd: false,
    pause,
    resume,
    setSleepTimer,
    startRadioFrom,
  });
});

afterEach(() => {
  cleanup();
});

describe("usePaletteActions", () => {
  it("offers transport, radio, sleep and library actions while a track plays", async () => {
    const { result } = await mountLoaded();
    expect(labels(result.current)).toEqual([
      "Pause",
      "Next track",
      "Start radio from current track",
      "Sleep timer: 30 minutes",
      "Shuffle library",
      "Resync library",
    ]);
  });

  it("offers only the library actions with nothing loaded, and nothing without a server", async () => {
    usePlayerStore.setState({ currentTrack: null, streamUrlFor: null, queue: [] });
    const { result } = await mountLoaded();
    expect(labels(result.current)).toEqual(["Shuffle library", "Resync library"]);
    cleanup();
    const withoutServer = await mountLoaded({ server: undefined });
    expect(labels(withoutServer.result.current)).toEqual([]);
  });

  it("toggles playback the way the play button does", async () => {
    const { result } = await mountLoaded();
    run(result.current, "Pause");
    expect(pause).toHaveBeenCalledTimes(1);
    act(() => usePlayerStore.setState({ isPlaying: false }));
    run(result.current, "Play");
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("drops next at the end of the queue and radio while radio already runs", async () => {
    usePlayerStore.setState({ queueIndex: 1, radioActive: true });
    const { result } = await mountLoaded();
    expect(labels(result.current)).not.toContain("Next track");
    expect(labels(result.current)).not.toContain("Start radio from current track");
  });

  it("starts radio seeded from the playing track", async () => {
    const { result } = await mountLoaded();
    run(result.current, "Start radio from current track");
    await waitFor(() => expect(startRadioFrom).toHaveBeenCalledTimes(1));
    expect(startRadioFrom).toHaveBeenCalledWith("replace", expect.objectContaining({ tracks: [], seed: track }));
  });

  it("shuffles the library as a random radio from one of its tracks", async () => {
    db.raw
      .prepare(
        "INSERT INTO albums (id, server_id, server_type, name, artist) VALUES ('a1', 'srv', 'navidrome', 'LP', 'X')",
      )
      .run();
    db.raw
      .prepare(
        "INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES ('lib-1', 'srv', 'navidrome', 'Deep Cut', 'X', 'a1')",
      )
      .run();
    const { result } = await mountLoaded();
    run(result.current, "Shuffle library");
    await waitFor(() => expect(startRadioFrom).toHaveBeenCalledTimes(1));
    expect(startRadioFrom).toHaveBeenCalledWith(
      "replace",
      expect.objectContaining({ mode: "random", tracks: [expect.objectContaining({ id: "lib-1", album: "LP" })] }),
    );
  });

  it("sets a 30 minute sleep timer and runs a forced resync", async () => {
    const { result } = await mountLoaded();
    run(result.current, "Sleep timer: 30 minutes");
    expect(setSleepTimer).toHaveBeenCalledWith(30);
    run(result.current, "Resync library");
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));
    expect(runSync).toHaveBeenCalledWith(SRV, { forceTrackPass: true });
  });

  it("does not re-render as the elapsed time ticks", async () => {
    const { renders } = await mountLoaded();
    const before = renders();
    act(() => usePlayerStore.setState({ elapsed: 10 }));
    act(() => usePlayerStore.setState({ elapsed: 11 }));
    expect(renders()).toBe(before);
    act(() => usePlayerStore.setState({ isPlaying: false }));
    expect(renders()).toBe(before + 1);
  });
});
