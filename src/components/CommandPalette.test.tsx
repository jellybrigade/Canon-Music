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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import type { Pins } from "../features/pins/pins";
import type { RecentItem } from "../features/recents/recents";
import type { ServerWithCredential } from "../hooks/useServer";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { CommandPalette } from "./CommandPalette";

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

// Mirrors src/features/search/useSearch.test.ts: tracks_fts has no trigger, sync.ts writes it
// explicitly, so seeding `tracks` alone leaves the index empty and every search returns
// nothing.
function seedAlbum(opts: { id: string; name: string; artist?: string | null; serverId?: string }) {
  db.raw
    .prepare(`INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, ?)`)
    .run(opts.id, opts.serverId ?? "srv-a", opts.name, opts.artist ?? null);
}

function seedArtistPortrait(name: string, url: string) {
  db.raw.prepare(`INSERT INTO artist_identity (artist_name, wikidata_image_url) VALUES (?, ?)`).run(name, url);
}

function seedTrack(opts: {
  id: string;
  title: string;
  artist?: string | null;
  albumId: string | null;
  serverId?: string;
}) {
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', ?, ?, ?)`,
    )
    .run(opts.id, opts.serverId ?? "srv-a", opts.title, opts.artist ?? null, opts.albumId);
  const albumName = opts.albumId
    ? ((db.raw.prepare(`SELECT name FROM albums WHERE id = ?`).get(opts.albumId) as { name: string } | undefined)
        ?.name ?? "")
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
const onOpenTrack = vi.fn();
const onPlayAlbum = vi.fn();
const onStartArtistRadio = vi.fn();
const onSearchAll = vi.fn();
const onOpened = vi.fn();
const onUnpin = vi.fn();

function renderPalette(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    open: true,
    onClose,
    onNavigate,
    onSelectAlbum,
    onSelectArtist,
    onPlayTrack,
    onOpenTrack,
    onPlayAlbum,
    onStartArtistRadio,
    onSearchAll,
    onOpened,
    onUnpin,
    serverWithCredential: SRV,
    ...props,
  } as React.ComponentProps<typeof CommandPalette>;
  const view = render(
    <QueryClientProvider client={client}>
      <CommandPalette {...all} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderWith: (next: Partial<React.ComponentProps<typeof CommandPalette>>) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <CommandPalette {...all} {...next} />
        </QueryClientProvider>,
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
  const el = document.querySelector(
    ".cp-item--focused .cp-nav-label, .cp-item--focused .cp-result-primary, .cp-item--focused .cp-shelf-name, .cp-item--focused .cp-see-all-label",
  );
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

// jsdom lays nothing out, so the shelf rows' carousels have nothing to observe.
class StubResizeObserver {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
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
  onOpenTrack.mockClear();
  onPlayAlbum.mockClear();
  onStartArtistRadio.mockClear();
  onSearchAll.mockClear();
  onOpened.mockClear();
  onUnpin.mockClear();
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

describe("CommandPalette commands in search", () => {
  const shuffle = vi.fn();
  const resync = vi.fn();
  const actions = [
    { id: "shuffle-library", label: "Shuffle library", icon: null, run: shuffle },
    { id: "resync-library", label: "Resync library", icon: null, run: resync },
  ];

  beforeEach(() => {
    shuffle.mockClear();
    resync.mockClear();
  });

  it("offers the matching Go to entry first, focused for Enter", async () => {
    seedFindableAlbum({ id: "a1", name: "Settlers" });
    renderPalette({ actions });
    typeRaw("sett");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Settings", "Settlers"]);
    expect(focusedLabel()).toBe("Settings");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs a matching action once and closes", async () => {
    renderPalette({ actions });
    typeRaw("library");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Library", "Shuffle library", "Resync library"]);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(shuffle).toHaveBeenCalledTimes(1);
    expect(resync).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps actions out of the empty palette", () => {
    renderPalette({ actions });
    expect(resultPrimaries()).toEqual([]);
    expect(navLabels()).toEqual(["Home", "Library", "Artists", "Playlists", "Queue", "Settings"]);
  });

  it("still offers commands when the library search fails", async () => {
    renderPalette({ actions });
    db.select = () => Promise.reject(new Error("db locked"));
    typeRaw("resync");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Resync library"]);
    expect(document.querySelector(".cp-empty")?.textContent).toBe(
      "Search failed. The library database could not be read.",
    );
  });
});

describe("CommandPalette pinned shelf", () => {
  const RADIOHEAD: Pins["artists"][number] = {
    name: "Radiohead",
    album_count: 9,
    lastfm_image_url: null,
    wikidata_image_url: null,
    navidrome_image_url: null,
    pinned_at: 1,
  };
  const pinnedAlbum = (id: string, name: string, pinnedAt: number): Pins["albums"][number] => ({
    id,
    server_id: "srv-b",
    name,
    artist: "Radiohead",
    year: null,
    artwork_url: null,
    pinned_at: pinnedAt,
  });
  const PINS: Pins = { artists: [RADIOHEAD], albums: [pinnedAlbum("al-1", "Kid A", 3)] };
  // Twenty-six albums, newest first by name: two more than a shelf row holds.
  const MANY: Pins = {
    artists: [],
    albums: Array.from({ length: 26 }, (_, i) => pinnedAlbum(`al-A${i + 1}`, `A${i + 1}`, 100 - i)),
  };
  const albumNames = (count: number) => MANY.albums.slice(0, count).map((album) => album.name);

  const shelfNames = () => Array.from(document.querySelectorAll(".cp-shelf-name"), (n) => n.textContent);
  const press = (key: string) => fireEvent.keyDown(window, { key });

  const rowNames = () =>
    Array.from(document.querySelectorAll(".cp-shelf"), (row) =>
      Array.from(row.querySelectorAll(".cp-shelf-name"), (n) => n.textContent),
    );

  it("shows artists and albums as two rows of tiles above the nav commands", () => {
    renderPalette({ pins: PINS });
    expect(rowNames()).toEqual([["Radiohead"], ["Kid A"]]);
    expect(resultPrimaries()).toEqual([]);
    expect(document.querySelector(".cp-section-label")?.textContent).toBe("Pinned");
    expect(document.querySelectorAll(".cp-shelf-art--artist")).toHaveLength(1);
    expect(navLabels()).toHaveLength(6);
  });

  const TWO_ROWS: Pins = {
    artists: [RADIOHEAD, { ...RADIOHEAD, name: "Portishead", pinned_at: 0 }],
    albums: [pinnedAlbum("al-1", "Kid A", 3), pinnedAlbum("al-2", "Amnesiac", 2), pinnedAlbum("al-3", "OK", 1)],
  };

  it("moves along a row with left and right, stopping at either end instead of wrapping into the next row", () => {
    renderPalette({ pins: TWO_ROWS });
    expect(focusedLabel()).toBe("Radiohead");
    press("ArrowRight");
    expect(focusedLabel()).toBe("Portishead");
    press("ArrowRight");
    expect(focusedLabel()).toBe("Portishead");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(focusedLabel()).toBe("Radiohead");
  });

  it("steps between the rows keeping the column, landing on the last tile of a shorter row", () => {
    renderPalette({ pins: TWO_ROWS });
    press("ArrowRight");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Amnesiac");
    press("ArrowRight");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Portishead");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Portishead");
  });

  it("drops from the last row into the Go to grid and back up, keeping the column both ways", () => {
    renderPalette({ pins: TWO_ROWS });
    press("ArrowDown");
    press("ArrowRight");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Library");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Queue");
    press("ArrowUp");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Amnesiac");
    press("ArrowRight");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Artists");
  });

  it("drops straight to the nav commands from a lone row", () => {
    renderPalette({ pins: { artists: [], albums: TWO_ROWS.albums } });
    press("ArrowRight");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Library");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Amnesiac");
  });

  it("keeps keys pressed before the typed search settles off the pins", () => {
    renderPalette({ pins: TWO_ROWS });
    typeRaw("abbey");
    expect(press("ArrowRight")).toBe(true);
    expect(press("Delete")).toBe(true);
    press("Enter");
    expect(onUnpin).not.toHaveBeenCalled();
    expect(onSelectArtist).not.toHaveBeenCalled();
    expect(onSearchAll.mock.calls).toEqual([["abbey"]]);
  });

  it("leaves left and right to the text field in the result lists", async () => {
    renderPalette();
    typeRaw("settings");
    await settleDebounce();
    expect(focusedLabel()).toBe("Settings");
    expect(press("ArrowLeft")).toBe(true);
    expect(press("ArrowRight")).toBe(true);
  });

  it("opens a pinned album with its own server id, and a pinned artist", () => {
    renderPalette({ pins: PINS });
    press("ArrowDown");
    press("Enter");
    expect(onSelectAlbum.mock.calls.map(([album]) => [album.id, album.server_id])).toEqual([["al-1", "srv-b"]]);

    cleanup();
    renderPalette({ pins: PINS });
    press("Enter");
    expect(onSelectArtist.mock.calls).toEqual([["Radiohead", 9]]);
  });

  it("holds twenty-four tiles a row, folding the rest of that row behind a count", () => {
    renderPalette({ pins: { artists: [], albums: MANY.albums.slice(0, 24) } });
    expect(shelfNames()).toEqual(albumNames(24));
    expect(document.querySelector(".cp-shelf-more")).toBeNull();

    cleanup();
    renderPalette({ pins: MANY });
    expect(shelfNames()).toEqual([...albumNames(23), "More"]);
    expect(document.querySelector(".cp-shelf-more .cp-shelf-art")?.textContent).toBe("+3");

    cleanup();
    renderPalette({ pins: { artists: [RADIOHEAD], albums: MANY.albums } });
    expect(rowNames()).toEqual([["Radiohead"], [...albumNames(23), "More"]]);
  });

  it("unfolds the rest in place from the count tile, keeping the palette open", () => {
    renderPalette({ pins: MANY });
    for (let i = 0; i < 23; i++) press("ArrowRight");
    expect(focusedLabel()).toBe("More");
    press("Enter");
    expect(shelfNames()).toEqual(albumNames(26));
    expect(focusedLabel()).toBe("A24");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelectAlbum).not.toHaveBeenCalled();
  });

  it("scrolls a row with its arrows without taking focus from the search field", () => {
    renderPalette({ pins: MANY });
    const next = document.querySelector(".cp-shelf .album-carousel__arrow--next");
    if (!next) throw new Error("no carousel arrow");
    expect(fireEvent.mouseDown(next)).toBe(false);
  });

  const tile = (name: string) => {
    const found = Array.from(document.querySelectorAll(".cp-shelf-tile")).find(
      (el) => el.querySelector(".cp-shelf-name")?.textContent === name,
    );
    if (!found) throw new Error(`no tile ${name}`);
    return found;
  };
  const rightClick = (el: Element) => {
    fireEvent.mouseDown(el, { button: 2 });
    fireEvent.contextMenu(el);
  };
  const unpinnedKeys = () => onUnpin.mock.calls.map(([pin]) => pin.key);

  it("unpins a tile from its right-click menu without opening it or closing the palette", () => {
    renderPalette({ pins: PINS });
    rightClick(tile("Kid A"));
    expect(onSelectAlbum).not.toHaveBeenCalled();

    const unpin = document.querySelector(".context-menu button");
    if (!unpin) throw new Error("no menu");
    expect(unpin.textContent).toBe("Unpin");
    fireEvent.click(unpin);

    expect(unpinnedKeys()).toEqual(["album:al-1"]);
    expect(document.querySelector(".context-menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape and Enter to the open menu", () => {
    renderPalette({ pins: PINS });
    rightClick(tile("Radiohead"));
    // From the search field, as a real key arrives: the menu listens on the document.
    const key = (name: string) => fireEvent.keyDown(input(), { key: name });
    key("Enter");
    expect(onSelectArtist).not.toHaveBeenCalled();
    key("Escape");
    expect(document.querySelector(".context-menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unpins the focused tile with Delete, the focus staying in its row", () => {
    const { rerenderWith } = renderPalette({ pins: TWO_ROWS });
    press("ArrowDown");
    press("ArrowRight");
    press("Delete");
    expect(unpinnedKeys()).toEqual(["album:al-2"]);
    rerenderWith({ pins: { ...TWO_ROWS, albums: TWO_ROWS.albums.filter((album) => album.id !== "al-2") } });
    expect(focusedLabel()).toBe("OK");

    press("Delete");
    expect(unpinnedKeys()).toEqual(["album:al-2", "album:al-3"]);
    rerenderWith({ pins: { ...TWO_ROWS, albums: TWO_ROWS.albums.slice(0, 1) } });
    expect(focusedLabel()).toBe("Kid A");
  });

  it("does nothing on Delete away from the pins", () => {
    renderPalette({ pins: { artists: [], albums: TWO_ROWS.albums } });
    press("ArrowDown");
    expect(focusedLabel()).toBe("Home");
    press("Delete");
    expect(onUnpin).not.toHaveBeenCalled();
  });

  it("hides the shelf once a query is typed", async () => {
    renderPalette({ pins: PINS });
    typeRaw("zzz");
    await settleDebounce();
    expect(shelfNames()).toEqual([]);
  });
});

describe("CommandPalette debounce", () => {
  // The searches only: the portrait keyset read on mount is the image cache's, once per app.
  const searchSelects = () => db.queryLog.filter((q) => q.kind === "select" && q.sql.includes("tracks_fts")).length;

  it("fires no query before the debounce settles", () => {
    renderPalette();
    typeRaw("wilco");
    expect(searchSelects()).toBe(0);
  });

  it("does not fire at 149ms, fires exactly 3 selects (albums/tracks/artists) at 150ms", async () => {
    seedFindableAlbum({ id: "a1", name: "Wilco Album" });
    renderPalette();
    typeRaw("wilco");
    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(searchSelects()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(searchSelects()).toBe(3);
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
    expect(searchSelects()).toBe(0);
    await settleDebounce();
    // Exactly 3, not 3 * 5 keystrokes: the burst produced one settled value.
    expect(searchSelects()).toBe(3);
    expect(resultPrimaries()).toEqual(["Wilco Album"]);
    expect(db.queryLog.filter((q) => q.sql.includes("FROM artist_covers"))).toHaveLength(1);
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
    spies.push(
      vi.spyOn(window, "addEventListener").mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        opts?: boolean | AddEventListenerOptions,
      ) => {
        if (type === "keydown") added.push(type);
        realAdd(type, listener, opts);
      }) as typeof window.addEventListener),
    );
    spies.push(
      vi.spyOn(window, "removeEventListener").mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        opts?: boolean | EventListenerOptions,
      ) => {
        if (type === "keydown") removed.push(type);
        realRemove(type, listener, opts);
      }) as typeof window.removeEventListener),
    );
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
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(focusedLabel()).toBe("Artists");
  });

  it("moves through the Go to grid by row and column, stopping at its edges", () => {
    const press = (key: string) => fireEvent.keyDown(window, { key });
    renderPalette();
    expect(focusedLabel()).toBe("Home");
    press("ArrowUp");
    press("ArrowLeft");
    expect(focusedLabel()).toBe("Home");
    press("ArrowRight");
    expect(focusedLabel()).toBe("Library");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Queue");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Queue");
    press("ArrowRight");
    press("ArrowRight");
    expect(focusedLabel()).toBe("Settings");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Artists");
  });

  it("clamps ArrowDown at the last result and ArrowUp at the first", async () => {
    seedFindableAlbum({ id: "a:one", name: "Zebra One" });
    seedFindableAlbum({ id: "a:two", name: "Zebra Two" });
    renderPalette();
    typeRaw("zebra");
    await settleDebounce();
    const [first] = resultPrimaries();
    expect(focusedLabel()).toBe(first);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(focusedLabel()).toBe(first);
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(focusedLabel()).toBe('See all results for "zebra"');
  });

  it("activates the focused item on Enter and closes", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
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
    expect(onOpenTrack.mock.calls).toEqual([[{ albumId: "a1", trackId: "t1" }]]);
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
    expect(onOpenTrack).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens a track's album at that track on Enter, without playing it", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    renderPalette();
    typeRaw("jesus");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Jesus, Etc."]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpenTrack.mock.calls).toEqual([[{ albumId: "a1", trackId: "t1" }]]);
    expect(onPlayTrack).not.toHaveBeenCalled();
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
    const library = Array.from(document.querySelectorAll<HTMLElement>(".cp-nav-item")).find((b) =>
      b.textContent?.includes("Library"),
    )!;
    // The handler is onMouseDown with preventDefault, so the input never blurs out from
    // under the selection. A click alone must therefore do nothing.
    fireEvent.click(library);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.mouseDown(library);
    expect(onNavigate).toHaveBeenCalledWith("library");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop press and release, not on either half alone", () => {
    renderPalette();
    const backdrop = () => document.querySelector(".cp-backdrop")!;
    fireEvent.mouseDown(document.querySelector(".cp-modal")!);
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop());
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
      "Search failed. The library database could not be read.",
    );
    expect(resultPrimaries()).toEqual([]);
  });

  it("selects an artist result and passes its album count", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel", artist: "Wilco" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    renderPalette();
    typeRaw("wilco");
    await settleDebounce();
    expect(document.querySelector(".cp-result-row .cp-result-detail")!.textContent).toBe("Artist · 1 album");
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

describe("CommandPalette Enter opens, Shift+Enter plays", () => {
  const press = (key: string, shiftKey = false) => fireEvent.keyDown(window, { key, shiftKey });
  const footerHints = () =>
    Array.from(document.querySelectorAll(".cp-footer > span"), (hint) => hint.textContent?.replace(/\s+/g, " ").trim());

  async function searchFor(query: string) {
    renderPalette();
    typeRaw(query);
    await settleDebounce();
  }

  it("plays a track on Shift+Enter instead of opening its album", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    await searchFor("jesus");
    press("Enter", true);
    expect(onPlayTrack.mock.calls).toEqual([["t1"]]);
    expect(onOpenTrack).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("plays a track with no album on Enter, having no album to open", async () => {
    seedTrack({ id: "t1", title: "Loose Single", artist: "Wilco", albumId: null });
    await searchFor("loose");
    expect(footerHints()).toEqual(["↑↓ navigate", "↵ play", "esc close"]);
    press("Enter");
    expect(onPlayTrack.mock.calls).toEqual([["t1"]]);
    expect(onOpenTrack).not.toHaveBeenCalled();
  });

  it("plays an album on Shift+Enter with the row's own server id, without opening it", async () => {
    seedAlbum({ id: "a1", name: "Kid A", artist: "Radiohead", serverId: "srv-a" });
    seedTrack({ id: "t1", title: "Everything In Its Right Place", artist: "Radiohead", albumId: "a1" });
    await searchFor("kid a");
    press("Enter", true);
    expect(onPlayAlbum.mock.calls.map(([album]) => [album.id, album.server_id])).toEqual([["a1", "srv-a"]]);
    expect(onSelectAlbum).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts an artist's radio on Shift+Enter instead of opening the artist", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel", artist: "Wilco" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    await searchFor("wilco");
    press("Enter", true);
    expect(onStartArtistRadio.mock.calls).toEqual([["Wilco"]]);
    expect(onSelectArtist).not.toHaveBeenCalled();
  });

  it("plays a pinned album and starts a pinned artist's radio on Shift+Enter", () => {
    const pins: Pins = {
      artists: [
        {
          name: "Radiohead",
          album_count: 9,
          lastfm_image_url: null,
          wikidata_image_url: null,
          navidrome_image_url: null,
          pinned_at: 1,
        },
      ],
      albums: [
        {
          id: "al-1",
          server_id: "srv-b",
          name: "Kid A",
          artist: "Radiohead",
          year: null,
          artwork_url: null,
          pinned_at: 2,
        },
      ],
    };
    renderPalette({ pins });
    press("Enter", true);
    expect(onStartArtistRadio.mock.calls).toEqual([["Radiohead"]]);

    cleanup();
    renderPalette({ pins });
    press("ArrowDown");
    press("Enter", true);
    expect(onPlayAlbum.mock.calls.map(([album]) => [album.id, album.server_id])).toEqual([["al-1", "srv-b"]]);
    expect(onSelectAlbum).not.toHaveBeenCalled();
    expect(onSelectArtist).not.toHaveBeenCalled();
  });

  it("goes to a page on Shift+Enter, since there is nothing to play", () => {
    renderPalette();
    press("Enter", true);
    expect(onNavigate.mock.calls).toEqual([["home"]]);
  });

  it("plays on a Shift+click and opens on a plain click", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel" });
    seedTrack({ id: "t1", title: "Jesus, Etc.", artist: "Wilco", albumId: "a1" });
    await searchFor("jesus");
    const row = () => document.querySelector(".cp-result-row")!;
    fireEvent.mouseDown(row(), { shiftKey: true });
    expect(onPlayTrack.mock.calls).toEqual([["t1"]]);
    expect(onOpenTrack).not.toHaveBeenCalled();
    fireEvent.mouseDown(row());
    expect(onOpenTrack.mock.calls).toEqual([[{ albumId: "a1", trackId: "t1" }]]);
  });

  it("names what Enter and Shift+Enter do for the focused row", async () => {
    seedAlbum({ id: "a1", name: "Wilco Album", artist: "Wilco" });
    seedTrack({ id: "t1", title: "Wilco Song", artist: "Wilco", albumId: "a1" });
    await searchFor("wilco");
    expect(resultPrimaries()).toEqual(["Wilco", "Wilco Album", "Wilco Song"]);
    expect(footerHints()).toEqual(["↑↓ navigate", "↵ open", "⇧↵ start radio", "esc close"]);
    press("ArrowDown");
    expect(footerHints()).toEqual(["↑↓ navigate", "↵ open", "⇧↵ play", "esc close"]);
    press("ArrowDown");
    expect(footerHints()).toEqual(["↑↓ navigate", "↵ open album", "⇧↵ play", "esc close"]);
  });

  it("offers no play hint where there is nothing to play", () => {
    renderPalette();
    expect(footerHints()).toEqual(["↑↓ navigate", "↵ go to", "esc close"]);
  });
});

function sectionLabels(): string[] {
  return Array.from(document.querySelectorAll(".cp-section-label")).map((n) => n.textContent!);
}

describe("CommandPalette top result", () => {
  function seedZebraArtist() {
    seedAlbum({ id: "a1", name: "Zebra One", artist: "Zebra" });
    seedTrack({ id: "t1", title: "Filler Song", artist: "Zebra", albumId: "a1" });
  }

  it("lifts the best match across kinds into one row on top, out of its own section", async () => {
    seedZebraArtist();
    renderPalette();
    typeRaw("zebra");
    await settleDebounce();
    expect(sectionLabels()).toEqual(["Top result", "Albums", "Tracks"]);
    expect(document.querySelector(".cp-top-row .cp-result-primary")?.textContent).toBe("Zebra");
    expect(document.querySelector(".cp-top-row .cp-result-detail")?.textContent).toBe("Artist · 1 album");
    expect(focusedLabel()).toBe("Zebra");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectArtist.mock.calls).toEqual([["Zebra", 1]]);
  });

  it("shows four rows a section under the top result", async () => {
    for (let i = 1; i <= 6; i++) seedFindableAlbum({ id: `a${i}`, name: `Zebra ${i}` });
    renderPalette();
    typeRaw("zebra");
    await settleDebounce();
    expect(resultPrimaries()).toEqual(["Zebra 1", "Zebra 2", "Zebra 3", "Zebra 4", "Zebra 5"]);
    const albumsSection = Array.from(document.querySelectorAll(".cp-section")).find(
      (section) => section.querySelector(".cp-section-label")?.textContent === "Albums",
    );
    expect(albumsSection?.querySelectorAll(".cp-result-row")).toHaveLength(4);
  });

  it("ends with a row that opens Search at the query, and closes", async () => {
    seedZebraArtist();
    renderPalette();
    typeRaw("zebra");
    await settleDebounce();
    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(focusedLabel()).toBe('See all results for "zebra"');
    expect(document.querySelector(".cp-footer")?.textContent).toContain("show all results");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSearchAll.mock.calls).toEqual([["zebra"]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers no See all row when nothing matched", async () => {
    renderPalette();
    typeRaw("nonexistentxyz");
    await settleDebounce();
    expect(document.querySelector(".cp-see-all-label")).toBeNull();
  });
});

describe("CommandPalette result rows", () => {
  it("keeps the previous rows, without an empty notice, while the next query runs", async () => {
    seedFindableAlbum({ id: "a1", name: "Zebra One" });
    renderPalette();
    typeRaw("zebra");
    await settleDebounce();
    setQuery("zebrx");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(resultPrimaries()).toEqual(["Zebra One"]);
    expect(document.querySelector(".cp-empty")).toBeNull();
  });

  it("shows an artist's portrait and a track's album art", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel", artist: "Wilco" });
    db.raw.prepare(`UPDATE albums SET artwork_url = 'al-a1' WHERE id = 'a1'`).run();
    seedTrack({ id: "t1", title: "Wilco (The Song)", artist: "Wilco", albumId: "a1" });
    seedArtistPortrait("Wilco", "https://img.example/wilco.jpg");
    renderPalette();
    typeRaw("wilco");
    await settleDebounce();
    const artistArt = document.querySelector(".cp-top-row img.cp-art--artist");
    expect(artistArt?.getAttribute("src")).toContain("wilco.jpg");
    const trackRow = Array.from(document.querySelectorAll(".cp-result-row")).find(
      (row) => row.querySelector(".cp-result-primary")?.textContent === "Wilco (The Song)",
    );
    expect(trackRow?.querySelector("img.cp-art")?.getAttribute("src")).toContain("al-a1");
    expect(trackRow?.querySelector(".cp-result-detail")?.textContent).toBe("Wilco · Yankee Hotel");
  });

  it("sets the typed words in bold inside each name", async () => {
    seedFindableAlbum({ id: "a1", name: "Zebra One" });
    renderPalette();
    typeRaw("zeb");
    await settleDebounce();
    const name = document.querySelector(".cp-top-row .cp-result-primary");
    expect(name?.textContent).toBe("Zebra One");
    expect(Array.from(name?.querySelectorAll(".cp-match") ?? []).map((n) => n.textContent)).toEqual(["Zeb"]);
  });

  it("holds the result space with skeleton rows while the first search runs", async () => {
    seedFindableAlbum({ id: "a1", name: "Zebra One" });
    renderPalette();
    typeRaw("zebra");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(document.querySelectorAll(".cp-skeleton-row").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Searching");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.querySelectorAll(".cp-skeleton-row")).toHaveLength(0);
    expect(resultPrimaries()).toEqual(["Zebra One"]);
  });
});

describe("CommandPalette accessibility", () => {
  it("exposes the rows as a listbox the field points into, following the highlight", async () => {
    seedFindableAlbum({ id: "a1", name: "Zebra One" });
    seedFindableAlbum({ id: "a2", name: "Zebra Two" });
    renderPalette();
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-controls")).toBe(listbox?.id);

    const activeOption = () => document.getElementById(input().getAttribute("aria-activedescendant") ?? "");
    expect(activeOption()?.textContent).toContain("Home");
    expect(activeOption()?.getAttribute("role")).toBe("option");
    expect(activeOption()?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(activeOption()?.textContent).toContain("Library");

    typeRaw("zebra");
    await settleDebounce();
    expect(activeOption()?.textContent).toContain("Zebra One");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(activeOption()?.textContent).toContain("Zebra Two");
    const options = document.querySelectorAll('[role="option"]');
    expect(Array.from(options).filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(new Set(Array.from(options, (o) => o.id)).size).toBe(options.length);
  });

  it("marks pinned tiles as options too", () => {
    const wilco: Pins["artists"][number] = {
      name: "Wilco",
      album_count: 2,
      lastfm_image_url: null,
      wikidata_image_url: null,
      navidrome_image_url: null,
      pinned_at: 1,
    };
    renderPalette({ pins: { artists: [wilco], albums: [] } });
    const tile = document.querySelector(".cp-shelf-tile");
    expect(tile?.getAttribute("role")).toBe("option");
    expect(input().getAttribute("aria-activedescendant")).toBe(tile?.id);
  });
});

describe("CommandPalette recents", () => {
  const RECENTS: RecentItem[] = [
    {
      kind: "track",
      key: "track:t1",
      openedAt: 3,
      track: {
        id: "t1",
        server_id: "srv-a",
        title: "Jesus, Etc.",
        artist: "Wilco",
        album_id: "a1",
        album_name: "Yankee Hotel",
        artwork_url: null,
      },
    },
    {
      kind: "album",
      key: "album:a2",
      openedAt: 2,
      album: { id: "a2", server_id: "srv-b", name: "Kid A", artist: "Radiohead", artwork_url: null },
    },
    {
      kind: "artist",
      key: "artist:Wilco",
      openedAt: 1,
      artist: {
        name: "Wilco",
        album_count: 3,
        lastfm_image_url: null,
        wikidata_image_url: null,
        navidrome_image_url: null,
      },
    },
  ];

  it("lists what was opened last between the pins and Go to, with what kind each is", () => {
    renderPalette({ recents: RECENTS });
    expect(sectionLabels()).toEqual(["Recent", "Go to"]);
    expect(resultPrimaries()).toEqual(["Jesus, Etc.", "Kid A", "Wilco"]);
    expect(Array.from(document.querySelectorAll(".cp-result-detail"), (n) => n.textContent)).toEqual([
      "Track · Wilco · Yankee Hotel",
      "Album · Radiohead",
      "Artist · 3 albums",
    ]);
    expect(focusedLabel()).toBe("Jesus, Etc.");
  });

  it("walks down the recents into the Go to grid and back up", () => {
    const press = (key: string) => fireEvent.keyDown(window, { key });
    renderPalette({ recents: RECENTS });
    press("ArrowDown");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Wilco");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Home");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Wilco");
  });

  it("opens and plays a recent like a search row, with the row's own server", () => {
    renderPalette({ recents: RECENTS });
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(onPlayTrack.mock.calls).toEqual([["t1"]]);
  });

  it("keeps recents out of a search", async () => {
    seedFindableAlbum({ id: "z1", name: "Zebra One" });
    renderPalette({ recents: RECENTS });
    typeRaw("zebra");
    await settleDebounce();
    expect(sectionLabels()).not.toContain("Recent");
  });

  it("records every album, artist and track it opens or plays, and no command", async () => {
    seedAlbum({ id: "a1", name: "Yankee Hotel", artist: "Wilco" });
    seedTrack({ id: "t1", title: "Wilco Song", artist: "Wilco", albumId: "a1" });
    renderPalette({ serverId: "srv-a", recents: RECENTS });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpened.mock.calls).toEqual([[{ kind: "album", serverId: "srv-b", albumId: "a2" }]]);

    onOpened.mockClear();
    typeRaw("wilco");
    await settleDebounce();
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(onOpened.mock.calls).toEqual([[{ kind: "artist", serverId: "srv-a", artistName: "Wilco" }]]);

    onOpened.mockClear();
    setQuery("wilco song");
    await settleDebounce();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpened.mock.calls).toEqual([[{ kind: "track", serverId: "srv-a", trackId: "t1" }]]);

    onOpened.mockClear();
    setQuery("settings");
    await settleDebounce();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(onOpened).not.toHaveBeenCalled();
  });
});
