// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../discogsLookups", () => ({ runDiscogsLookups: vi.fn() }));
vi.mock("../../tags/lib/tagNormalize", () => ({ normalizeAlbum: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../../../db";
import { __resetSettingCache, useSetting } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createMigratedTestDb, type FakeDatabase, holdSettingReads } from "../../../test/sqlite";
import { normalizeAlbum } from "../../tags/lib/tagNormalize";
import { type DiscogsLookupOptions, runDiscogsLookups } from "../discogsLookups";
import { useDiscogsLookups } from "./useDiscogsLookups";

let db: FakeDatabase;
let client: QueryClient;

function render(lastSyncedAt: number | null) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(
    ({ syncedAt }) => {
      useDiscogsLookups(syncedAt);
      return useSetting("tags.auto_refresh", "true")[1];
    },
    {
      wrapper,
      initialProps: { syncedAt: lastSyncedAt },
    },
  );
}

function setAutoRefresh(value: string): void {
  db.raw.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tags.auto_refresh', ?)").run(value);
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let finishHeldPass = () => {};

// Holds the pass open until the test ends and hands back its options, so a test can act while it runs.
function holdPass(): { options: () => DiscogsLookupOptions } {
  let options: DiscogsLookupOptions | null = null;
  vi.mocked(runDiscogsLookups).mockImplementationOnce(async (_db, _now, passOptions) => {
    options = passOptions;
    await new Promise<void>((resolve) => {
      finishHeldPass = resolve;
    });
  });
  return {
    options: () => {
      if (options === null) throw new Error("pass not started");
      return options;
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(runDiscogsLookups).mockResolvedValue();
  vi.mocked(normalizeAlbum).mockResolvedValue({ genres: [], descriptors: [], scenes: [], computed_at: 1 });
  client = new QueryClient();
});

afterEach(() => {
  finishHeldPass();
  cleanup();
});

describe("useDiscogsLookups", () => {
  it("runs one pass after each sync", async () => {
    const { rerender } = render(1);
    await waitFor(() => expect(runDiscogsLookups).toHaveBeenCalledTimes(1));

    rerender({ syncedAt: 1 });
    rerender({ syncedAt: 2 });
    await waitFor(() => expect(runDiscogsLookups).toHaveBeenCalledTimes(2));
  });

  it("waits for the setting, and looks nothing up with background refresh turned off", async () => {
    setAutoRefresh("false");
    const release = holdSettingReads(db, "tags.auto_refresh");
    render(1);
    await flush();
    expect(runDiscogsLookups).toHaveBeenCalledTimes(0);

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runDiscogsLookups).toHaveBeenCalledTimes(0);
  });

  it("ends a running pass when background refresh is turned off", async () => {
    const pass = holdPass();
    const { result } = render(1);
    await waitFor(() => expect(runDiscogsLookups).toHaveBeenCalledTimes(1));
    expect(pass.options().shouldStop()).toBe(false);

    await act(async () => {
      await result.current("false");
    });
    await waitFor(() => expect(pass.options().shouldStop()).toBe(true));
  });

  it("refreshes the facts of each album found", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const pass = holdPass();
    render(1);
    await waitFor(() => expect(runDiscogsLookups).toHaveBeenCalledTimes(1));

    pass.options().onFound({ albumId: "a1", serverId: "s" });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["looked-up-facts", "a1", "s"] });
  });

  it("refiles the genres of each album found, then refreshes them", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const pass = holdPass();
    render(1);
    await waitFor(() => expect(runDiscogsLookups).toHaveBeenCalledTimes(1));

    pass.options().onFound({ albumId: "a1", serverId: "s" });

    expect(normalizeAlbum).toHaveBeenCalledTimes(1);
    expect(normalizeAlbum).toHaveBeenCalledWith("a1");
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QK.normalizedTags("a1") }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QK.albumUnmatchedGenres("a1") });
    expect(invalidate).toHaveBeenCalledTimes(3);
  });
});
