// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { Profiler } from "react";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { usePlayerStore } from "../../playback/store/player";
import { type CurrentTrack } from "../../playback/store/playerTypes";
import { useRadioStartStore } from "../store/radioStart";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { RadioButton } from "./RadioButton";

let db: FakeDatabase;
const current: CurrentTrack = { id: "c", title: "Current", artist: null, duration: 100 };
const other: CurrentTrack = { id: "o", title: "Other", artist: null, duration: 100 };
const streamUrlFor = (t: CurrentTrack) => t.id;

const toggle = () => document.querySelector<HTMLButtonElement>(".radio-btn")!;
const menu = () => document.querySelector(".radio-menu");

async function mount() {
  render(<RadioButton />);
  await waitFor(() => expect(db.selectCount).toBe(1));
  await act(async () => {});
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  useRadioStartStore.setState({ pending: null });
  usePlayerStore.setState({
    queue: [current, other],
    queueIndex: 0,
    currentTrack: current,
    streamUrlFor,
    radioActive: false,
    radioSeed: null,
    radioLabel: null,
    radioMode: "curated",
  });
});

afterEach(() => {
  cleanup();
});

describe("RadioButton", () => {
  it("offers to start radio from the playing track when radio is off", async () => {
    await mount();

    expect(toggle().getAttribute("aria-label")).toBe("Start radio");
    expect(toggle().classList.contains("player-btn--active")).toBe(false);

    fireEvent.click(toggle());

    const pending = useRadioStartStore.getState().pending;
    expect(pending?.seed).toBe(current);
    expect(pending?.tracks).toEqual([]);
    expect(menu()).toBeNull();
  });

  it("is disabled with nothing playing", async () => {
    usePlayerStore.setState({ currentTrack: null, queue: [] });
    await mount();

    expect(toggle().disabled).toBe(true);
  });

  it("shows radio as on and opens the mode menu when radio is running", async () => {
    usePlayerStore.setState({ radioActive: true, radioSeed: current, radioLabel: "Shoegaze" });
    await mount();

    expect(toggle().getAttribute("aria-label")).toBe("Radio: Shoegaze");
    expect(toggle().classList.contains("player-btn--active")).toBe(true);

    fireEvent.click(toggle());

    expect(menu()).not.toBeNull();
    expect(useRadioStartStore.getState().pending).toBeNull();
  });

  it("stops radio from the menu", async () => {
    usePlayerStore.setState({ radioActive: true, radioSeed: current });
    await mount();

    fireEvent.click(toggle());
    fireEvent.click(document.querySelector(".radio-menu-item--stop")!);

    expect(usePlayerStore.getState().radioActive).toBe(false);
    expect(menu()).toBeNull();
  });

  it("does not re-render on playback ticks", async () => {
    let commits = 0;
    render(
      <Profiler id="radio" onRender={() => { commits++; }}>
        <RadioButton />
      </Profiler>
    );
    await waitFor(() => expect(db.selectCount).toBe(1));
    await act(async () => {});
    const before = commits;

    act(() => {
      for (let i = 1; i <= 10; i++) usePlayerStore.setState({ elapsed: i });
    });

    expect(commits).toBe(before);
  });
});
