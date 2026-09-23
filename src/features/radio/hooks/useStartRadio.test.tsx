// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { usePlayerStore, type CurrentTrack } from "../../playback/store/player";
import { useRadioStartStore } from "../store/radioStart";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { resolveRadioStart, useStartRadio, RADIO_START_ACTION_SETTING } from "./useStartRadio";

let db: FakeDatabase;
const startRadioFrom = vi.fn(() => Promise.resolve());
const seed: CurrentTrack = { id: "s", title: "Seed", artist: null, duration: 100 };
const request = { tracks: [seed], streamUrlFor: (t: CurrentTrack) => t.id };

function setStored(value: string) {
  db.raw.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(RADIO_START_ACTION_SETTING, value);
}

async function mountLoaded() {
  const hook = renderHook(() => useStartRadio());
  await waitFor(() => expect(db.selectCount).toBe(1));
  // The count moves when the read is issued; let its result land before the case acts.
  await act(async () => {});
  return hook;
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  startRadioFrom.mockClear();
  usePlayerStore.setState({ queue: [seed, seed], startRadioFrom });
  useRadioStartStore.setState({ pending: null });
});

afterEach(() => {
  cleanup();
});

describe("resolveRadioStart", () => {
  it("asks when the setting says ask and there is a queue to lose", () => {
    expect(resolveRadioStart("ask", 3)).toBe("ask");
  });

  it("replaces without asking when the queue is empty", () => {
    expect(resolveRadioStart("ask", 0)).toBe("replace");
    expect(resolveRadioStart("queue_last", 0)).toBe("queue_last");
  });

  it("follows a remembered choice", () => {
    expect(resolveRadioStart("replace", 3)).toBe("replace");
    expect(resolveRadioStart("queue_last", 3)).toBe("queue_last");
  });

  it("treats an unknown stored value as ask", () => {
    expect(resolveRadioStart("bogus", 3)).toBe("ask");
  });
});

describe("useStartRadio", () => {
  it("parks the request for the dialog when the choice is ask", async () => {
    const { result } = await mountLoaded();

    act(() => void result.current(request));

    expect(useRadioStartStore.getState().pending).toBe(request);
    expect(startRadioFrom).toHaveBeenCalledTimes(0);
  });

  it("starts straight away on an empty queue", async () => {
    usePlayerStore.setState({ queue: [] });
    const { result } = await mountLoaded();

    act(() => void result.current(request));

    expect(useRadioStartStore.getState().pending).toBeNull();
    expect(startRadioFrom).toHaveBeenCalledTimes(1);
    expect(startRadioFrom).toHaveBeenCalledWith("replace", request);
  });

  it("uses the stored choice without asking", async () => {
    setStored("queue_last");
    const { result } = await mountLoaded();

    act(() => void result.current(request));

    expect(useRadioStartStore.getState().pending).toBeNull();
    expect(startRadioFrom).toHaveBeenCalledTimes(1);
    expect(startRadioFrom).toHaveBeenCalledWith("queue_last", request);
  });

  it("reads the setting once across many starts", async () => {
    setStored("replace");
    const { result } = await mountLoaded();
    const readsAfterMount = db.selectCount;

    act(() => {
      for (let i = 0; i < 5; i++) void result.current(request);
    });

    expect(db.selectCount).toBe(readsAfterMount);
    expect(startRadioFrom).toHaveBeenCalledTimes(5);
  });
});
