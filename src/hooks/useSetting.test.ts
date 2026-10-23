// @vitest-environment jsdom
vi.mock("../db", () => ({ getDb: vi.fn(async () => db) }));

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSettingCache, refreshAllSettings, storeSetting, useBoolSetting } from "./useSetting";

interface PendingWrite {
  value: string;
  finish: () => void;
  fail: (error: Error) => void;
}

let writes: PendingWrite[] = [];
const db = {
  select: vi.fn(async (): Promise<{ key?: string; value: string }[]> => []),
  execute: vi.fn(
    (_sql: string, [, value]: string[]) =>
      new Promise<void>((resolve, reject) => {
        writes.push({ value: value!, finish: resolve, fail: reject });
      }),
  ),
};

async function renderLoaded() {
  const view = renderHook(() => useBoolSetting("test.flag", false));
  await waitFor(() => expect(view.result.current[2]).toBe(true));
  return view;
}

beforeEach(() => {
  writes = [];
  db.execute.mockClear();
  db.select.mockReset();
  db.select.mockImplementation(async () => []);
  __resetSettingCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSetting updates", () => {
  it("shows the new value before a busy database has stored it", async () => {
    const { result } = await renderLoaded();

    act(() => void result.current[1](true));
    expect(result.current[0]).toBe(true);
    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("stores quick changes one at a time, in the order they were made", async () => {
    const { result } = await renderLoaded();

    act(() => void result.current[1](true));
    act(() => void result.current[1](false));
    expect(result.current[0]).toBe(false);
    await waitFor(() => expect(writes.map((w) => w.value)).toEqual(["true"]));

    await act(async () => writes[0]!.finish());
    await waitFor(() => expect(writes.map((w) => w.value)).toEqual(["true", "false"]));
  });

  it("goes back to the stored value when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await renderLoaded();

    let update: Promise<void> | undefined;
    act(() => {
      update = result.current[1](true);
    });
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      writes[0]!.fail(new Error("disk full"));
      // Reported and undone here, so a caller that drops the promise leaves no unhandled rejection.
      await expect(update).resolves.toBeUndefined();
    });
    expect(result.current[0]).toBe(false);
  });

  it("keeps a later change when an earlier write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await renderLoaded();

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current[1](true);
    });
    act(() => void result.current[1](false));
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      writes[0]!.fail(new Error("disk full"));
      await first;
    });
    expect(result.current[0]).toBe(false);
  });
});

describe("useSetting reads racing writes", () => {
  it("keeps a change made while the stored value was still loading", async () => {
    let finishRead: (rows: { value: string }[]) => void = () => {};
    db.select.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const { result } = renderHook(() => useBoolSetting("test.flag", false));

    await waitFor(() => expect(db.select).toHaveBeenCalledTimes(1));
    act(() => void result.current[1](true));
    await act(async () => finishRead([{ value: "false" }]));

    expect(result.current[0]).toBe(true);
    expect(result.current[2]).toBe(true);
  });

  it("shows the stored value, not the default, when a change fails before the first read lands", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let finishRead: (rows: { value: string }[]) => void = () => {};
    db.select.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const { result } = renderHook(() => useBoolSetting("test.flag", false));

    await waitFor(() => expect(db.select).toHaveBeenCalledTimes(1));
    act(() => void result.current[1](false));
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => writes[0]!.fail(new Error("disk full")));
    await act(async () => finishRead([{ value: "true" }]));

    expect(result.current[0]).toBe(true);
  });

  it("stores a bulk value after a change still on its way to the database", async () => {
    const { result } = await renderLoaded();

    act(() => void result.current[1](true));
    const stored = storeSetting("test.flag", "false");
    await waitFor(() => expect(writes.map((w) => w.value)).toEqual(["true"]));

    await act(async () => writes[0]!.finish());
    await waitFor(() => expect(writes.map((w) => w.value)).toEqual(["true", "false"]));
    await act(async () => {
      writes[1]!.finish();
      await stored;
    });
  });

  it("re-reads only after changes on their way to the database have landed", async () => {
    const { result } = await renderLoaded();
    act(() => void result.current[1](true));
    await waitFor(() => expect(writes).toHaveLength(1));
    db.select.mockClear();
    db.select.mockImplementation(async () => [{ key: "test.flag", value: "true" }]);

    const refresh = refreshAllSettings();
    await Promise.resolve();
    expect(db.select).not.toHaveBeenCalled();

    await act(async () => {
      writes[0]!.finish();
      await refresh;
    });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe(true);
  });
});
