// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../releaseDateLookups", () => ({ runReleaseDateLookups: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { createMigratedTestDb, type FakeDatabase, holdSettingReads } from "../../../test/sqlite";
import { runReleaseDateLookups } from "../releaseDateLookups";
import { useReleaseDateLookups } from "./useReleaseDateLookups";

let db: FakeDatabase;
let client: QueryClient;

function render(lastSyncedAt: number | null) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(({ syncedAt }) => useReleaseDateLookups(syncedAt, "s"), {
    wrapper,
    initialProps: { syncedAt: lastSyncedAt },
  });
}

function setAutoRefresh(value: string): void {
  db.raw.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tags.auto_refresh', ?)").run(value);
}

beforeEach(async () => {
  vi.clearAllMocks();
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(runReleaseDateLookups).mockResolvedValue({ changed: false });
  client = new QueryClient();
});

afterEach(() => {
  cleanup();
});

describe("useReleaseDateLookups", () => {
  it("runs one pass after each sync", async () => {
    const { rerender } = render(1);
    await waitFor(() => expect(runReleaseDateLookups).toHaveBeenCalledTimes(1));

    rerender({ syncedAt: 1 });
    rerender({ syncedAt: 2 });
    await waitFor(() => expect(runReleaseDateLookups).toHaveBeenCalledTimes(2));
  });

  it("waits for the first sync", async () => {
    const { rerender } = render(null);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runReleaseDateLookups).toHaveBeenCalledTimes(0);

    rerender({ syncedAt: 1 });
    await waitFor(() => expect(runReleaseDateLookups).toHaveBeenCalledTimes(1));
  });

  it("looks nothing up with background refresh turned off", async () => {
    setAutoRefresh("false");
    const probe = vi.fn();
    vi.mocked(getDb).mockImplementation(async () => {
      probe();
      return db as never;
    });
    render(1);
    await waitFor(() => expect(probe).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runReleaseDateLookups).toHaveBeenCalledTimes(0);
  });

  it("waits until the setting is read, so a turned-off switch is never run past", async () => {
    setAutoRefresh("false");
    const release = holdSettingReads(db, "tags.auto_refresh");
    render(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runReleaseDateLookups).toHaveBeenCalledTimes(0);

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runReleaseDateLookups).toHaveBeenCalledTimes(0);
  });

  it("asks for one more pass when a sync lands during a pass", async () => {
    let finish: (value: { changed: boolean }) => void = () => {};
    vi.mocked(runReleaseDateLookups).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(1);
    await waitFor(() => expect(runReleaseDateLookups).toHaveBeenCalledTimes(1));
    rerender({ syncedAt: 2 });
    rerender({ syncedAt: 3 });

    await act(async () => {
      finish({ changed: false });
    });
    await waitFor(() => expect(runReleaseDateLookups).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runReleaseDateLookups).toHaveBeenCalledTimes(2);
  });

  it("refreshes Recently Released and album labels only when a pass changed what they show", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.mocked(runReleaseDateLookups).mockResolvedValueOnce({ changed: false });
    vi.mocked(runReleaseDateLookups).mockResolvedValueOnce({ changed: true });
    const { rerender } = render(1);
    await waitFor(() => expect(runReleaseDateLookups).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invalidate).toHaveBeenCalledTimes(0);

    rerender({ syncedAt: 2 });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["recently-released"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["looked-up-facts"] });
  });
});
