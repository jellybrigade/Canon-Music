// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunSyncOptions, SyncOutcome, SyncStatus } from "../../features/sync/useLibrarySync";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import { useNewAlbumsCheck } from "./useNewAlbumsCheck";

const SERVER: ServerWithCredential = {
  server: {
    id: "a",
    type: "navidrome",
    url: "https://a.example",
    alt_url: null,
    display_name: "A",
    username: "u",
    created_at: "2026-01-01",
  },
  credential: { type: "apikey", apiKey: "k" },
};

function albums(...ids: string[]): AlbumRow[] {
  return ids.map((id) => ({ id, server_id: "a", name: id, artist: null, year: null, artwork_url: null }));
}

const OTHER_SERVER: ServerWithCredential = { ...SERVER, server: { ...SERVER.server, id: "b" } };

interface Props {
  items: AlbumRow[] | undefined;
  syncStatus: SyncStatus;
  serverWithCred?: ServerWithCredential;
}

function setup(options: { accepts?: boolean } = {}) {
  let onSettled: RunSyncOptions["onSettled"];
  const runSync = vi.fn((_s: ServerWithCredential, runOptions?: RunSyncOptions) => {
    onSettled = runOptions?.onSettled;
    return options.accepts ?? true;
  });
  const initialItems = albums("old-1", "old-2");
  const hook = renderHook((props: Props) => useNewAlbumsCheck({ serverWithCred: SERVER, runSync, ...props }), {
    initialProps: { items: initialItems, syncStatus: "idle" },
  });
  const settleWith = (outcome: SyncOutcome) => act(() => onSettled?.(outcome));
  const settle = (albumsChanged: boolean) => settleWith({ status: "done", albumsChanged, error: "" });
  const showItems = (items: AlbumRow[], syncStatus: SyncStatus = "done") => hook.rerender({ items, syncStatus });
  return { hook, runSync, settle, settleWith, showItems, initialItems };
}

describe("useNewAlbumsCheck sync", () => {
  it("starts one sync for the shown server per click", () => {
    const { hook, runSync } = setup();

    act(() => hook.result.current.checkForNewAlbums());

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync.mock.calls[0]?.[0]).toBe(SERVER);
  });
});

describe("useNewAlbumsCheck scroll to start", () => {
  it("asks for the start once the read after a run that added albums lands", () => {
    const { hook, settle, showItems } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    settle(true);
    expect(hook.result.current.scrollToStartRequest).toBe(0);
    showItems(albums("new-1", "old-1", "old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(1);
  });

  it("asks for the start when new albums land mid-sync", () => {
    const { hook, showItems } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    showItems(albums("new-1", "old-1", "old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(1);
  });

  it("stays put when the changed albums left the front alone, and stops watching", () => {
    const { hook, settle, showItems } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    settle(true);
    showItems(albums("old-1", "old-2"));
    showItems(albums("background-1", "old-1", "old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(0);
  });

  it("stops watching after a run that changed no albums", () => {
    const { hook, settle, showItems } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    settle(false);
    showItems(albums("background-1", "old-1", "old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(0);
  });

  it("stops watching when the read after its run never lands and a later sync starts", () => {
    const { hook, settle, showItems, initialItems } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    settle(true);
    showItems(initialItems, "syncing");
    showItems(albums("background-1", "old-1", "old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(0);
  });

  it("stays put when an album it already showed comes to the front", () => {
    const { hook, showItems } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    showItems(albums("old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(0);
  });

  it("stops watching when the server changes", () => {
    const { hook } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    hook.rerender({ items: albums("other-1"), syncStatus: "syncing", serverWithCred: OTHER_SERVER });

    expect(hook.result.current.scrollToStartRequest).toBe(0);
  });

  it("never moves for a sync it did not start", () => {
    const { hook, showItems } = setup({ accepts: false });

    act(() => hook.result.current.checkForNewAlbums());
    showItems(albums("background-1", "old-1", "old-2"));

    expect(hook.result.current.scrollToStartRequest).toBe(0);
  });
});

describe("useNewAlbumsCheck failure note", () => {
  it.each([
    ["error", "Couldn't check for new albums"],
    ["partial", "Sync incomplete"],
    ["done", null],
  ] as const)("reads its own run's %s as %s", (status, note) => {
    const { hook, settleWith } = setup();

    act(() => hook.result.current.checkForNewAlbums());
    settleWith({ status, albumsChanged: false, error: "server said no" });

    expect(hook.result.current.note).toBe(note);
    expect(hook.result.current.noteDetail).toBe("server said no");
  });

  it("says nothing about a sync it did not start", () => {
    const { hook } = setup();

    hook.rerender({ items: albums("old-1"), syncStatus: "error" });

    expect(hook.result.current.note).toBeNull();
  });

  it("drops its note when the server changes", () => {
    const { hook, settleWith } = setup();
    act(() => hook.result.current.checkForNewAlbums());
    settleWith({ status: "error", albumsChanged: false, error: "down" });

    hook.rerender({ items: albums("other-1"), syncStatus: "error", serverWithCred: OTHER_SERVER });

    expect(hook.result.current.note).toBeNull();
  });

  it("reports busy only while its own run is in flight", () => {
    const { hook, settle } = setup();
    hook.rerender({ items: albums("old-1"), syncStatus: "syncing" });
    expect(hook.result.current.isChecking).toBe(false);

    act(() => hook.result.current.checkForNewAlbums());
    expect(hook.result.current.isChecking).toBe(true);
    settle(false);

    expect(hook.result.current.isChecking).toBe(false);
  });
});
