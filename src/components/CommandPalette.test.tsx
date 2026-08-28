// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

// Matches AlbumGrid.test.tsx: useAlbumDisplayName pulls four settings out of the real hook,
// which would otherwise hit the DB on every render. A map this file controls avoids that.
const settings = new Map<string, string>();
vi.mock("../hooks/useSetting", () => ({
  useSetting: (key: string, def: string) => [settings.get(key) ?? def, async () => {}, true],
  useBoolSetting: (key: string, def: boolean) => [
    settings.has(key) ? settings.get(key) === "true" : def,
    async () => {},
    true,
  ],
}));

import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "./CommandPalette";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { resetTauriMocks } from "../test/mocks/tauri";
import type { ServerWithCredential } from "../hooks/useServer";

const SRV: ServerWithCredential = {
  server: {
    id: "srv-a",
    type: "navidrome",
    url: "https://music.example",
    alt_url: null,
    display_name: "Home",
    username: "marcel",
    created_at: "2026-01-01T00:00:00Z",
  } as ServerWithCredential["server"],
  credential: { type: "md5", token: "tok", salt: "salt" } as ServerWithCredential["credential"],
};

let db: FakeDatabase;

// Mirrors src/hooks/useSearch.test.ts: tracks_fts has no trigger, sync.ts writes it
// explicitly, so seeding `tracks` alone leaves the index empty and every search returns
// nothing.
function seedAlbum(opts: { id: string; name: string; artist?: string | null; serverId?: string }) {
  db.raw
    .prepare(`INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, ?)`)
    .run(opts.id, opts.serverId ?? "srv-a", opts.name, opts.artist ?? null);
}

function seedTrack(opts: { id: string; title: string; artist?: string | null; albumId: string | null; serverId?: string }) {
  db.raw
    .prepare(`INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', ?, ?, ?)`)
    .run(opts.id, opts.serverId ?? "srv-a", opts.title, opts.artist ?? null, opts.albumId);
  const albumName = opts.albumId
    ? ((db.raw.prepare(`SELECT name FROM albums WHERE id = ?`).get(opts.albumId) as { name: string } | undefined)?.name ?? "")
    : "";
  db.raw
    .prepare(`INSERT INTO tracks_fts (id, title, artist, album, genre) VALUES (?, ?, ?, ?, '')`)
    .run(opts.id, opts.title, opts.artist ?? "", albumName);
}

/**
 * An album reachable by search. Every query runs through `tracks_fts` and joins out to
 * `albums` via `tracks`, so an album with no track on it is invisible no matter what its
 * name is. The filler track carries a null artist and a title that matches nothing, so
 * the album is the only row that scores.
 */
function seedFindableAlbum(opts: { id: string; name: string; serverId?: string }) {
  seedAlbum({ id: opts.id, name: opts.name, serverId: opts.serverId });
  seedTrack({ id: `${opts.id}-trk`, title: "Filler Song", artist: null, albumId: opts.id, serverId: opts.serverId });
}

const onClose = vi.fn();
const onNavigate = vi.fn();
const onSelectAlbum = vi.fn();
const onSelectArtist = vi.fn();
const onPlayTrack = vi.fn();

function renderPalette(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    open: true,
    onClose,
    onNavigate,
    onSelectAlbum,
    onSelectArtist,
    onPlayTrack,
    serverWithCredential: SRV,
    ...props,
  } as React.ComponentProps<typeof CommandPalette>;
  const view = render(
    <QueryClientProvider client={client}>
      <CommandPalette {...all} />
    </QueryClientProvider>
  );
  return {
    ...view,
    rerenderWith: (next: Partial<React.ComponentProps<typeof CommandPalette>>) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <CommandPalette {...all} {...next} />
        </QueryClientProvider>
      ),
  };
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(".cp-input")!;
}

function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".cp-nav-label")).map((n) => n.textContent!);
}

function resultPrimaries(): string[] {
  return Array.from(document.querySelectorAll(".cp-result-primary")).map((n) => n.textContent!);
}

function focusedLabel(): string | null {
  const el = document.querySelector(".cp-item--focused .cp-nav-label, .cp-item--focused .cp-result-primary");
  return el ? el.textContent : null;
}

/** Types text a character at a time from empty, via fireEvent.change, without advancing timers. */
function typeRaw(text: string) {
  let acc = "";
  for (const ch of text) {
    acc += ch;
    fireEvent.change(input(), { target: { value: acc } });
  }
}

/** Replaces the whole input value in one event, for the second query of a test. */
function setQuery(value: string) {
  fireEvent.change(input(), { target: { value } });
}

/**
 * Advances past the debounce and gives the query's own promise chain a turn to settle.
 * The second act is what lets a rejected select reach `isError` rather than leaving the
 * hook pending; the boundary test below advances by hand instead so it still measures
 * the 149/150 edge exactly.
 */
async function settleDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeAll(() => {
  // The palette scrolls the focused row into view on every focusedIdx change, and jsdom
  // does not implement scrollIntoView at all - without this the component throws on mount.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
});

beforeEach(async () => {
  vi.useFakeTimers();
  resetTauriMocks();
  settings.clear();
  onClose.mockClear();
  onNavigate.mockClear();
  onSelectAlbum.mockClear();
  onSelectArtist.mockClear();
  onPlayTrack.mockClear();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CommandPalette empty-query state", () => {
  it("shows the six nav commands and fires no search", () => {
    renderPalette();
    expect(navLabels()).toEqual(["Home", "Library", "Artists", "Playlists", "Queue", "Settings"]);
    expect(db.selectCount).toBe(0);
  });

  it("focuses the input asynchronously on open", async () => {
    renderPalette();
    expect(document.activeElement).not.toBe(input());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(document.activeElement).toBe(input());
  });
});

describe("CommandPalette debounce", () => {
  it("fires no query before the debounce settles", () => {
    renderPalette();
    typeRaw("wilco");
    expect(db.selectCount).toBe(0);
  });

  it("does not fire at 149ms, fires exactly 3 selects (albums/tracks/artists) at 150ms", async () => {
    seedFindableAlbum({ id: "a1", name: "Wilco Album" });
    renderPalette();
    typeRaw("wilco");
    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(db.selectCount).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(db.selectCount).toBe(3);
  });

  it("collapses a rapid multi-keystroke burst into one settled query, not one per keystroke", async () => {
    // The regression this file exists for: known-issues.md records that `useDeferredValue`
    // defers rendering only, so gating a queryKey with it still fires one search per
    // keystroke. Verified by replacing the setTimeout in CommandPalette.tsx with a bare
    // setDeferred: the pre-settle count below goes from 0 to 15, three selects per
    // keystroke, and the debounce boundary test above fails the same way.
    seedFindableAlbum({ id: "a1", name: "Wilco Album" });
    renderPalette();
    // Five keystrokes, each well inside the 150ms window, each resetting the timer.
    for (const partial of ["w", "wi", "wil", "wilc", "wilco"]) {
      fireEvent.change(input(), { target: { value: partial } });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    expect(db.selectCount).toBe(0);
    await settleDebounce();
    // Exactly 3, not 3 * 5 keystrokes: the burst produced one settled value.
    expect(db.selectCount).toBe(3);
    expect(resultPrimaries()).toEqual(["Wilco Album"]);
  });

  it("clears the previous session's results on reopen rather than painting them until the timer catches up", async () => {
    seedFindableAlbum({ id: "a1", name: "Wilco Album" });
    const { rerenderWith } = renderPalette();
    typeRaw("wilco");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Wilco Album"]);

    rerenderWith({ open: false });
    rerenderWith({ open: true });

    // `deferred` is reset alongside `raw`. Resetting only `raw` would leave the old rows
    // on screen for the 150ms until the debounce wrote the empty string through.
    expect(input().value).toBe("");
    expect(resultPrimaries()).toEqual([]);
    expect(navLabels()).toEqual(["Home", "Library", "Artists", "Playlists", "Queue", "Settings"]);
  });
});

/**
 * The window keydown listener is armed once for as long as the palette is open. Its handler
 * reads the result list, the focused row and the activate callback through a ref, so the rows
 * arriving and the user arrowing through them cannot re-arm it. Same shape as the fix already
 * pinned for `useSearchShortcuts` in `App.keyboard.test.tsx`.
 */
describe("CommandPalette listener churn", () => {
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  function countKeydownListeners() {
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);
    spies.push(vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions
    ) => {
      if (type === "keydown") added.push(type);
      realAdd(type, listener, opts);
    }) as typeof window.addEventListener));
    spies.push(vi.spyOn(window, "removeEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | EventListenerOptions
    ) => {
      if (type === "keydown") removed.push(type);
      realRemove(type, listener, opts);
    }) as typeof window.removeEventListener));
    return { added, removed };
  }

  it("arms the keydown listener once across a full type, settle and arrow session", async () => {
    seedFindableAlbum({ id: "a:one", name: "Zebra One" });
    seedFindableAlbum({ id: "a:two", name: "Zebra Two" });
    const { added, removed } = countKeydownListeners();
    const { unmount } = renderPalette();
    expect(added.length).toBe(1);
    typeRaw("zebra");
    await settleDebounce();
    expect(resultPrimaries()).toHaveLength(2);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(added.length).toBe(1);
    expect(removed.length).toBe(0);
    unmount();
    expect(removed.length).toBe(1);
  });

  it("does not re-arm the listener when the server credential object is replaced", () => {
    const { added } = countKeydownListeners();
    const { rerenderWith } = renderPalette();
    expect(added.length).toBe(1);
    rerenderWith({ serverWithCredential: { ...SRV } });
    expect(added.length).toBe(1);
  });
});

describe("CommandPalette keyboard navigation", () => {
  it("accumulates two arrow presses delivered in one task rather than collapsing them", () => {
    // The handler is on a native window listener, so its state updates are batched into a
    // microtask rather than flushed synchronously. Reading the focused row off a render-time
    // snapshot makes two presses in one task both start from the same row and move only once.
    // Real key repeat puts a task boundary between presses, so only an updater derived from
    // the previous value pins the property.
    renderPalette();
    expect(focusedLabel()).toBe("Home");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(focusedLabel()).toBe("Artists");
  });

  it("clamps ArrowDown at the last item and ArrowUp at the first", () => {
    renderPalette();
    expect(focusedLabel()).toBe("Home");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(focusedLabel()).toBe("Home");
    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(focusedLabel()).toBe("Settings");
  });

  it("activates the focused item on Enter and closes", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(focusedLabel()).toBe("Artists");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("artists");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter on the first result when an arrow key lands before the results do", async () => {
    // The debounce settles before the select resolves, so there is a window where the query
    // is live and the list is empty. An arrow key there used to move a numeric cursor off the
    // end of a zero-length list, and nothing put it back once the rows arrived: no row was
    // highlighted and Enter did nothing until the user pressed ArrowUp.
    seedAlbum({ id: "a1", name: "Yankee Hotel" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    renderPalette();
    typeRaw("jesus");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(resultPrimaries()).toEqual([]);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(resultPrimaries()).toEqual(["Jesus, Etc."]);
    expect(focusedLabel()).toBe("Jesus, Etc.");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
    expect(onPlayTrack).toHaveBeenCalledWith("t1");
  });

  it("falls back to the first row rather than holding the ordinal when the rows are replaced", async () => {
    // Switching server re-keys the search without touching the typed query, so a new set of
    // rows arrives under a focus the user placed on the old set. Holding position 3 would
    // silently move the highlight onto a stranger's row and Enter would open it.
    seedFindableAlbum({ id: "a:one", name: "Zebra One" });
    seedFindableAlbum({ id: "a:two", name: "Zebra Two" });
    seedFindableAlbum({ id: "a:three", name: "Zebra Three" });
    seedFindableAlbum({ id: "b:alpha", name: "Zebra Alpha", serverId: "srv-b" });
    seedFindableAlbum({ id: "b:beta", name: "Zebra Beta", serverId: "srv-b" });
    seedFindableAlbum({ id: "b:gamma", name: "Zebra Gamma", serverId: "srv-b" });
    const { rerenderWith } = renderPalette({ serverId: "srv-a" });
    typeRaw("zebra");
    await settleDebounce();
    expect(resultPrimaries()).toHaveLength(3);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const heldRow = focusedLabel();
    rerenderWith({ serverId: "srv-b" });
    await settleDebounce();
    const newRows = resultPrimaries();
    expect(newRows).toHaveLength(3);
    expect(newRows).not.toContain(heldRow);
    expect(focusedLabel()).toBe(newRows[0]);
  });

  it("does nothing on Enter when the search has zero results", async () => {
    renderPalette();
    typeRaw("nonexistentxyz");
    await settleDebounce();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onSelectAlbum).not.toHaveBeenCalled();
    expect(onSelectArtist).not.toHaveBeenCalled();
    expect(onPlayTrack).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("selects a track result via Enter with its id, leaving other callbacks untouched", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    renderPalette();
    typeRaw("jesus");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Jesus, Etc."]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
    expect(onPlayTrack).toHaveBeenCalledWith("t1");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("closes on Escape without activating anything", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("CommandPalette mouse interaction", () => {
  it("activates a nav command on mousedown, not click", () => {
    renderPalette();
    const library = Array.from(document.querySelectorAll<HTMLElement>(".cp-nav-item")).find(
      (b) => b.textContent?.includes("Library")
    )!;
    // The handler is onMouseDown with preventDefault, so the input never blurs out from
    // under the selection. A click alone must therefore do nothing.
    fireEvent.click(library);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.mouseDown(library);
    expect(onNavigate).toHaveBeenCalledWith("library");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop mousedown but not on a mousedown inside the modal", () => {
    renderPalette();
    fireEvent.mouseDown(document.querySelector(".cp-modal")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.querySelector(".cp-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CommandPalette result states", () => {
  it("shows the empty state for a query with no matches", async () => {
    renderPalette();
    typeRaw("zzzznomatch");
    await settleDebounce();
    expect(document.querySelector(".cp-empty")!.textContent).toBe('No results for "zzzznomatch"');
  });

  it("shows the error state and wins over any stale results", async () => {
    seedFindableAlbum({ id: "a1", name: "Wilco Album" });
    renderPalette();
    typeRaw("wilco");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Wilco Album"]);

    // Force the next query to fail. placeholderData keeps the old rows in `data`, so the
    // error branch has to win outright rather than render alongside them.
    db.select = () => Promise.reject(new Error("boom"));
    setQuery("wilco2");
    await settleDebounce();
    expect(document.querySelector(".cp-empty")!.textContent).toBe(
      "Search failed. The library database could not be read."
    );
    expect(resultPrimaries()).toEqual([]);
  });

  it("selects an artist result and passes its album count", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel", artist: "Wilco" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    renderPalette();
    typeRaw("wilco");
    await settleDebounce();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectArtist).toHaveBeenCalledTimes(1);
    expect(onSelectArtist).toHaveBeenCalledWith("Wilco", 1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("selects an album result, stamping the row's own server_id rather than the selected server's", async () => {
    seedAlbum({ id: "a1", name: "Kid A", artist: "Radiohead" });
    seedTrack({ id: "t1", title: "Everything In Its Right Place", artist: "Radiohead", albumId: "a1" });
    renderPalette();
    typeRaw("kid a");
    await settleDebounce();
    // Only the album scores: "Radiohead" and the track title both miss "kid a" entirely,
    // so the album is the single item and sits at the default focus.
    expect(resultPrimaries()).toEqual(["Kid A"]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectAlbum).toHaveBeenCalledTimes(1);
    expect(onSelectAlbum.mock.calls[0]![0]).toMatchObject({ id: "a1", server_id: "srv-a", name: "Kid A" });
  });

  it("still searches while the credential is pending, using the plain server id", async () => {
    seedFindableAlbum({ id: "a1", name: "Wilco Album" });
    // App.tsx/HomeView pass server?.id, not serverWithCredential?.server.id - the credential
    // query can stay pending or fail (retry: false) indefinitely without blocking search.
    renderPalette({ serverWithCredential: undefined, serverId: "srv-a" });
    typeRaw("wilco");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Wilco Album"]);
  });
});
