// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlaybackTab } from "./PlaybackTab";
import { usePlayerStore, type CurrentTrack } from "../../store/player";
import { useRadioStartStore } from "../../store/radioStart";
import { __resetSettingCache } from "../../hooks/useSetting";
import { useStartRadio, RADIO_START_ACTION_SETTING } from "../../hooks/useStartRadio";
import { getDb } from "../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";

let db: FakeDatabase;
const startRadioFrom = vi.fn(() => Promise.resolve());
const seed: CurrentTrack = { id: "s", title: "Seed", artist: null, duration: 100 };
const request = { tracks: [seed], streamUrlFor: (t: CurrentTrack) => t.id };

const select = () => document.querySelector<HTMLSelectElement>('select[aria-label="Start radio action"]')!;

function storedSetting(): string | undefined {
  const row = db.raw.prepare("SELECT value FROM settings WHERE key = ?").get(RADIO_START_ACTION_SETTING) as { value: string } | undefined;
  return row?.value;
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlaybackTab searchQuery="" serverId={undefined} />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  startRadioFrom.mockClear();
  usePlayerStore.setState({ queue: [seed], startRadioFrom });
  useRadioStartStore.setState({ pending: null });
});

afterEach(() => {
  cleanup();
});

describe("PlaybackTab start radio action", () => {
  it("defaults to asking every time", async () => {
    renderTab();
    await waitFor(() => expect(select()).not.toBeNull());
    expect(select().value).toBe("ask");
  });

  it("a choice made here stops the dialog, and Ask every time brings it back", async () => {
    renderTab();
    await waitFor(() => expect(select()).not.toBeNull());
    const { result } = renderHook(() => useStartRadio());

    await act(async () => fireEvent.change(select(), { target: { value: "replace" } }));
    await waitFor(() => expect(storedSetting()).toBe("replace"));
    await act(async () => { await result.current(request); });
    expect(useRadioStartStore.getState().pending).toBeNull();
    expect(startRadioFrom).toHaveBeenCalledTimes(1);
    expect(startRadioFrom).toHaveBeenCalledWith("replace", request);

    await act(async () => fireEvent.change(select(), { target: { value: "ask" } }));
    await waitFor(() => expect(storedSetting()).toBe("ask"));
    await act(async () => { await result.current(request); });
    expect(useRadioStartStore.getState().pending).toBe(request);
    expect(startRadioFrom).toHaveBeenCalledTimes(1);
  });

  it("follows a choice remembered from the dialog", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(RADIO_START_ACTION_SETTING, "queue_last");
    renderTab();
    await waitFor(() => expect(select()?.value).toBe("queue_last"));
  });
});
