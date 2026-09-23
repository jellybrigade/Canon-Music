// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { usePlayerStore, type CurrentTrack } from "../../playback/store/player";
import { useRadioStartStore } from "../store/radioStart";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { __resetModalRegistry } from "../../../ui/useModalChrome";
import { useStartRadio, RADIO_START_ACTION_SETTING } from "../hooks/useStartRadio";
import { Profiler } from "react";
import { RadioStartDialogHost } from "./RadioStartDialog";

let db: FakeDatabase;
const startRadioFrom = vi.fn(() => Promise.resolve());
const seed: CurrentTrack = { id: "s", title: "Seed", artist: null, duration: 100 };
const request = { tracks: [seed], streamUrlFor: (t: CurrentTrack) => t.id };

const dialog = () => document.querySelector(".radio-start-dialog");
const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".radio-start-dialog .radio-start-btn")).find((b) => b.textContent === name)!;
const rememberBox = () => document.querySelector<HTMLInputElement>(".radio-start-remember input")!;

function storedSetting(): string | undefined {
  const row = db.raw.prepare("SELECT value FROM settings WHERE key = ?").get(RADIO_START_ACTION_SETTING) as { value: string } | undefined;
  return row?.value;
}

async function openDialog() {
  render(<RadioStartDialogHost />);
  act(() => useRadioStartStore.getState().ask(request));
  await waitFor(() => expect(dialog()).not.toBeNull());
}

beforeEach(async () => {
  __resetSettingCache();
  __resetModalRegistry();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  startRadioFrom.mockClear();
  usePlayerStore.setState({ queue: [seed, seed, seed], startRadioFrom });
  useRadioStartStore.setState({ pending: null });
});

afterEach(() => {
  cleanup();
});

describe("RadioStartDialog", () => {
  it("renders nothing without a pending start", () => {
    render(<RadioStartDialogHost />);
    expect(dialog()).toBeNull();
  });

  it("says how many tracks the queue holds", async () => {
    await openDialog();
    expect(dialog()!.textContent).toContain("3 tracks");
  });

  it("adds to the queue on Add to queue and forgets nothing it was not told to", async () => {
    await openDialog();

    await act(async () => fireEvent.click(button("Add to queue")));

    expect(startRadioFrom).toHaveBeenCalledTimes(1);
    expect(startRadioFrom).toHaveBeenCalledWith("queue_last", request);
    expect(useRadioStartStore.getState().pending).toBeNull();
    expect(dialog()).toBeNull();
    expect(storedSetting()).toBeUndefined();
  });

  it("replaces the queue on Replace queue", async () => {
    await openDialog();

    await act(async () => fireEvent.click(button("Replace queue")));

    expect(startRadioFrom).toHaveBeenCalledTimes(1);
    expect(startRadioFrom).toHaveBeenCalledWith("replace", request);
  });

  it("remembers the choice when Always do this is ticked, and does not ask again", async () => {
    await openDialog();

    fireEvent.click(rememberBox());
    await act(async () => fireEvent.click(button("Add to queue")));

    await waitFor(() => expect(storedSetting()).toBe("queue_last"));

    const { result } = renderHook(() => useStartRadio());
    await act(async () => { await result.current(request); });

    expect(useRadioStartStore.getState().pending).toBeNull();
    expect(dialog()).toBeNull();
    expect(startRadioFrom).toHaveBeenCalledTimes(2);
    expect(startRadioFrom).toHaveBeenLastCalledWith("queue_last", request);
  });

  it("starts nothing on Escape", async () => {
    await openDialog();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(startRadioFrom).toHaveBeenCalledTimes(0);
    expect(useRadioStartStore.getState().pending).toBeNull();
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("does not re-render on playback ticks while open", async () => {
    let commits = 0;
    render(
      <Profiler id="host" onRender={() => { commits++; }}>
        <RadioStartDialogHost />
      </Profiler>
    );
    act(() => useRadioStartStore.getState().ask(request));
    await waitFor(() => expect(dialog()).not.toBeNull());
    const before = commits;

    act(() => {
      for (let i = 1; i <= 10; i++) usePlayerStore.setState({ elapsed: i });
    });

    expect(commits).toBe(before);
  });
});
