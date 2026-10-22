// @vitest-environment jsdom
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../clients/notice", () => ({ fetchRemoteNotice: vi.fn() }));

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRemoteNotice } from "../clients/notice";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { useRemoteNotice } from "./useRemoteNotice";
import { __resetSettingCache } from "./useSetting";

const NOTICE = { id: "n1", message: "Hello" };
let db: FakeDatabase;

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(fetchRemoteNotice).mockReset();
  vi.mocked(fetchRemoteNotice).mockResolvedValue(NOTICE);
});

afterEach(() => {
  cleanup();
});

describe("useRemoteNotice", () => {
  it("keeps a dismissed notice hidden when it arrives before the setting is read", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('notice.last_seen_id', 'n1')").run();
    let releaseDb: () => void = () => {};
    const dbReady = new Promise<void>((resolve) => {
      releaseDb = resolve;
    });
    vi.mocked(getDb).mockImplementation(() => dbReady.then(() => db as unknown as Awaited<ReturnType<typeof getDb>>));
    const { result } = renderHook(() => useRemoteNotice());
    await act(async () => {});
    await act(async () => releaseDb());
    await waitFor(() => expect(fetchRemoteNotice).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.remoteNotice).toBeNull();
  });

  it("shows an unseen notice and hides it for good once dismissed", async () => {
    const { result } = renderHook(() => useRemoteNotice());
    await waitFor(() => expect(result.current.remoteNotice).toEqual(NOTICE));
    await act(() => result.current.dismissRemoteNotice());
    expect(result.current.remoteNotice).toBeNull();
    expect(db.raw.prepare("SELECT value FROM settings WHERE key = 'notice.last_seen_id'").get()).toEqual({
      value: "n1",
    });
    expect(fetchRemoteNotice).toHaveBeenCalledTimes(1);
  });
});
