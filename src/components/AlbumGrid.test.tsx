// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

// useLoved is mocked at the hook, matching TrackTableView.test.tsx: the only loved behavior
// this file asserts is that the heart does not also open the album, and letting the real
// hook run would drag a Subsonic star request into every card-click test.
const lovedAlbumIds = new Set<string>();
const toggleAlbumLove = vi.fn();
vi.mock("../hooks/useLoved", () => ({
  useLoved: () => ({ lovedAlbumIds, toggleAlbumLove }),
}));

// useSetting keeps a module-level cache that outlives a test's database, so a value written
// in one test would leak into the next through it. Mocked with a map this file controls
// instead. AlbumGrid reads two settings itself and useAlbumDisplayName reads four more.
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
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlbumGrid } from "./AlbumGrid";
import { getDb } from "../db";
import { createMigratedTestDb } from "../test/sqlite";
import { resetTauriMocks } from "../test/mocks/tauri";
import type { AlbumRow } from "../types/library";
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

// The stubbed viewport, and the geometry AlbumGrid derives from it. Restated here rather
// than imported because the point of the scrubber tests is to pin the numbers the component
// computes: if AlbumGrid's constants change, these literals must be updated deliberately.
const WIDTH = 900;
const HEIGHT = 800;
const PADDING = 20;
const COL_GAP = 16;
const ROW_GAP = 24;
const CARD_MIN = 190;
const YEAR_HEADER_HEIGHT = 38;

const AVAILABLE = WIDTH - PADDING * 2;
const COLS = Math.max(1, Math.floor((AVAILABLE + COL_GAP) / (CARD_MIN + COL_GAP)));
const CARD_W = (AVAILABLE - COL_GAP * (COLS - 1)) / COLS;
const ROW_H = Math.round(CARD_W) + ROW_GAP;

function album(over: Partial<AlbumRow> & { id: string; name: string }): AlbumRow {
  return {
    server_id: "srv-a",
    artist: null,
    year: null,
    // Null artwork keeps every card on the placeholder branch, so no test reaches
    // AlbumArt's network fallback.
    artwork_url: null,
    ...over,
  };
}

/** n albums named "<letter> 0", "<letter> 1", ... for a stable alphabetical order. */
function lettered(letters: string[], perLetter: number): AlbumRow[] {
  const out: AlbumRow[] = [];
  for (const L of letters)
    for (let i = 0; i < perLetter; i++)
      out.push(album({ id: `srv-a:${L}${i}`, name: `${L} album ${i}`, artist: `${L} artist` }));
  return out;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const onSelect = vi.fn();

function renderGrid(props: Partial<React.ComponentProps<typeof AlbumGrid>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    albums: [],
    serverWithCredential: SRV,
    onSelect,
    ...props,
  } as React.ComponentProps<typeof AlbumGrid>;
  const view = render(
    <QueryClientProvider client={client}>
      <AlbumGrid {...all} />
    </QueryClientProvider>
  );
  return {
    ...view,
    rerenderWith: (next: Partial<React.ComponentProps<typeof AlbumGrid>>) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <AlbumGrid {...all} {...next} />
        </QueryClientProvider>
      ),
  };
}

/** Absolutely positioned album rows, in render order. */
function gridRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".album-grid-scroller > div > div"))
    .filter((el) => !el.classList.contains("year-group-header"));
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".album-card"));
}

function cardNames(): string[] {
  return cards().map((c) => c.querySelector(".album-name")!.textContent!);
}

function scrubberLabels(): string[] {
  return Array.from(document.querySelectorAll(".album-grid-scrubber-item")).map(
    (b) => b.textContent!
  );
}

function clickScrubber(label: string) {
  const btn = Array.from(document.querySelectorAll<HTMLElement>(".album-grid-scrubber-item")).find(
    (b) => b.textContent === label
  );
  if (!btn) throw new Error(`no scrubber button "${label}"; have ${scrubberLabels().join(",")}`);
  fireEvent.click(btn);
}

const scrollTo = vi.fn();

beforeAll(() => {
  // AlbumGrid measures its own width with a raw `new ResizeObserver`, which jsdom does not
  // implement at all - without this the component throws on mount. @tanstack/react-virtual
  // reads offsetWidth/offsetHeight for the scroll rect and virtualizes every row away when
  // they are 0, which jsdom reports for every element.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => WIDTH });
  // Every scroll target is clamped to getMaxScrollOffset(), which virtual-core reads as
  // scrollHeight - clientHeight. jsdom reports 0 for both, so without these two an offset
  // assertion passes against a value clamped to 0 no matter what the component computed.
  // scrollHeight is derived from the sizing div the grid renders rather than stubbed flat,
  // so the clamp still tracks the real content height.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const inner = this.firstElementChild as HTMLElement | null;
      const height = inner?.style?.height;
      return height ? parseInt(height, 10) : 0;
    },
  });
  // jsdom has no scrollTo; virtual-core calls it optionally, so without a stub every scroll
  // assertion would silently pass against a call that never happened.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
});

beforeEach(async () => {
  resetTauriMocks();
  localStorage.clear();
  settings.clear();
  lovedAlbumIds.clear();
  toggleAlbumLove.mockClear();
  onSelect.mockClear();
  scrollTo.mockClear();
  const db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
});

afterEach(cleanup);

describe("AlbumGrid geometry derived from the container width", () => {
  it("derives four columns and a 227px row pitch from a 900px container", () => {
    // Every offset expectation below is built from these two, so a silent change to
    // CARD_MIN/COL_GAP/ROW_GAP fails here first with a readable number.
    expect(COLS).toBe(4);
    expect(ROW_H).toBe(227);
  });
});

describe("AlbumGrid load / empty / error states", () => {
  it("renders the error state with a working retry", () => {
    const onRetry = vi.fn();
    renderGrid({ albums: [], error: "network down", onRetry });
    expect(screen.getByText("Couldn't load your albums")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when no onRetry is supplied", () => {
    renderGrid({ albums: [], error: "network down" });
    expect(screen.getByText("Couldn't load your albums")).toBeInTheDocument();
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });

  it("renders the error state rather than skeletons when a read fails while loading", () => {
    // Opposite precedence to TrackTableView: a failed read leaves the caller's data
    // undefined and isLoading true, so a skeleton would pulse over the failure forever.
    renderGrid({ albums: [], isLoading: true, error: "boom" });
    expect(screen.getByText("Couldn't load your albums")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading albums")).not.toBeInTheDocument();
  });

  it("renders eighteen skeleton cards while loading an empty library", () => {
    renderGrid({ albums: [], isLoading: true });
    const skeleton = screen.getByLabelText("Loading albums");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton.querySelectorAll(".skeleton-card")).toHaveLength(18);
    expect(cards()).toHaveLength(0);
  });

  it("keeps rows on screen when a background refresh fails", () => {
    renderGrid({ albums: lettered(["A"], 2), error: "network down" });
    expect(cardNames()).toEqual(["A album 0", "A album 1"]);
    expect(screen.queryByText("Couldn't load your albums")).not.toBeInTheDocument();
  });

  it("keeps rows on screen while a refresh is loading", () => {
    renderGrid({ albums: lettered(["A"], 2), isLoading: true });
    expect(cardNames()).toEqual(["A album 0", "A album 1"]);
    expect(screen.queryByLabelText("Loading albums")).not.toBeInTheDocument();
  });

  it("renders the caller's empty message when one is given", () => {
    renderGrid({ albums: [], emptyMessage: { title: "No live albums", hint: "Try another filter" } });
    expect(screen.getByText("No live albums")).toBeInTheDocument();
    expect(screen.getByText("Try another filter")).toBeInTheDocument();
    expect(screen.queryByText("No albums here yet")).not.toBeInTheDocument();
  });

  it("teaches the default empty state when no message is given", () => {
    renderGrid({ albums: [] });
    expect(screen.getByText("No albums here yet")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a server in Settings and sync your library to fill this grid.")
    ).toBeInTheDocument();
    expect(document.querySelector(".album-grid-scrubber")).toBeNull();
  });
});

describe("AlbumGrid row chunking", () => {
  it("puts a single album in one row", () => {
    renderGrid({ albums: lettered(["A"], 1) });
    expect(gridRows()).toHaveLength(1);
    expect(cardNames()).toEqual(["A album 0"]);
  });

  it("fills exactly one row at the column count", () => {
    renderGrid({ albums: lettered(["A"], COLS) });
    expect(gridRows()).toHaveLength(1);
    expect(cards()).toHaveLength(COLS);
  });

  it("spills one album past a full row into a second row", () => {
    renderGrid({ albums: lettered(["A"], COLS + 1) });
    const rows = gridRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelectorAll(".album-card")).toHaveLength(1);
  });

  it("lays each row out as a column-count grid", () => {
    renderGrid({ albums: lettered(["A"], COLS) });
    expect(gridRows()[0]!.style.gridTemplateColumns).toBe(`repeat(${COLS}, 1fr)`);
    expect(gridRows()[0]!.style.gap).toBe(`${COL_GAP}px`);
  });

  it("re-measures and renders rows when albums arrive after an empty first render", () => {
    // The empty branch renders no scroller content, so containerWidth is only re-read by
    // the prevAlbumsLen effect. Without it the first non-empty render is a 1-column grid.
    const { rerenderWith } = renderGrid({ albums: [] });
    expect(cards()).toHaveLength(0);
    rerenderWith({ albums: lettered(["A"], COLS) });
    expect(gridRows()).toHaveLength(1);
    expect(cards()).toHaveLength(COLS);
  });

  it("groups year-sorted albums under one header per year", () => {
    const albums = [
      album({ id: "srv-a:1", name: "One", year: 1999 }),
      album({ id: "srv-a:2", name: "Two", year: 1999 }),
      album({ id: "srv-a:3", name: "Three", year: 2001 }),
    ];
    renderGrid({ albums, sort: "year" });
    const headers = Array.from(document.querySelectorAll(".year-group-header")).map((h) => h.textContent);
    expect(headers).toEqual(["1999", "2001"]);
    expect(gridRows()).toHaveLength(2);
  });

  it("labels a null year 'Unknown'", () => {
    renderGrid({ albums: [album({ id: "srv-a:1", name: "One", year: null })], sort: "year" });
    expect(document.querySelector(".year-group-header")!.textContent).toBe("Unknown");
  });

  it("splits a year run longer than one row into several rows under one header", () => {
    const albums = Array.from({ length: COLS + 1 }, (_, i) =>
      album({ id: `srv-a:${i}`, name: `Album ${i}`, year: 1999 })
    );
    renderGrid({ albums, sort: "year" });
    expect(document.querySelectorAll(".year-group-header")).toHaveLength(1);
    expect(gridRows()).toHaveLength(2);
  });
});

describe("AlbumGrid virtualization", () => {
  it("renders a bounded window of rows for a huge library", () => {
    renderGrid({ albums: lettered(ALPHABET, 400) }); // 10400 albums, 2600 rows
    // At scroll offset 0: ceil(800 / 227) = 4 rows intersect the viewport, plus 3 rows of
    // trailing overscan. The leading overscan is clamped away at the top of the list.
    expect(gridRows()).toHaveLength(7);
    expect(cards()).toHaveLength(7 * COLS);
  });

  it("sizes the scroll surface for every row plus the grid's own padding", () => {
    renderGrid({ albums: lettered(["A"], COLS * 10) });
    const surface = document.querySelector<HTMLElement>(".album-grid-scroller > div")!;
    expect(surface.style.height).toBe(`${10 * ROW_H + PADDING * 2}px`);
  });

  it("paints the first row inset by the grid padding", () => {
    renderGrid({ albums: lettered(["A"], COLS) });
    expect(gridRows()[0]!.style.top).toBe(`${PADDING}px`);
    expect(gridRows()[0]!.style.left).toBe(`${PADDING}px`);
  });

  it("stacks rows one row pitch apart", () => {
    renderGrid({ albums: lettered(["A"], COLS * 3) });
    const tops = gridRows().map((r) => parseInt(r.style.top, 10));
    expect(tops).toEqual([PADDING, PADDING + ROW_H, PADDING + 2 * ROW_H]);
  });
});

describe("AlbumGrid scrubber sections", () => {
  it("is hidden when no sort is given", () => {
    renderGrid({ albums: lettered(ALPHABET, 4) });
    expect(document.querySelector(".album-grid-scrubber")).toBeNull();
  });

  it("is hidden for recently_added, which has no meaningful index", () => {
    renderGrid({ albums: lettered(ALPHABET, 4), sort: "recently_added" });
    expect(document.querySelector(".album-grid-scrubber")).toBeNull();
  });

  it("is hidden when every album falls in one section", () => {
    renderGrid({ albums: lettered(["A"], 8), sort: "alphabetical" });
    expect(document.querySelector(".album-grid-scrubber")).toBeNull();
  });

  it("appears at two sections", () => {
    renderGrid({ albums: lettered(["A", "B"], COLS), sort: "alphabetical" });
    expect(scrubberLabels()).toEqual(["A", "B"]);
  });

  it("indexes on the artist under artist sort and on the name under alphabetical sort", () => {
    const albums = [
      ...Array.from({ length: COLS }, (_, i) =>
        album({ id: `srv-a:z${i}`, name: `Zulu ${i}`, artist: "Bravo" })
      ),
      ...Array.from({ length: COLS }, (_, i) =>
        album({ id: `srv-a:y${i}`, name: `Alpha ${i}`, artist: "Charlie" })
      ),
    ];
    const { rerenderWith } = renderGrid({ albums, sort: "artist" });
    expect(scrubberLabels()).toEqual(["B", "C"]);
    rerenderWith({ sort: "alphabetical" });
    expect(scrubberLabels()).toEqual(["Z", "A"]);
  });

  it("falls back to the album name when an artist-sorted album has no artist", () => {
    const albums = [
      ...Array.from({ length: COLS }, (_, i) => album({ id: `srv-a:n${i}`, name: `Nadir ${i}`, artist: null })),
      ...Array.from({ length: COLS }, (_, i) => album({ id: `srv-a:q${i}`, name: `Q ${i}`, artist: "Quebec" })),
    ];
    renderGrid({ albums, sort: "artist" });
    expect(scrubberLabels()).toEqual(["N", "Q"]);
  });

  it("uppercases a lowercase initial and buckets non-letters under '#'", () => {
    const albums = [
      ...Array.from({ length: COLS }, (_, i) => album({ id: `srv-a:d${i}`, name: `düsseldorf ${i}` })),
      ...Array.from({ length: COLS }, (_, i) => album({ id: `srv-a:9${i}`, name: `9 to 5 - ${i}` })),
      ...Array.from({ length: COLS }, (_, i) => album({ id: `srv-a:e${i}`, name: `Émigré ${i}` })),
    ];
    renderGrid({ albums, sort: "alphabetical" });
    // "É" is not in /[A-Z]/, so an accented initial indexes under "#" alongside the digits,
    // and the second "#" run reuses the first section rather than adding a duplicate button.
    expect(scrubberLabels()).toEqual(["D", "#"]);
  });

  it("seeds a section only from the first album of a row", () => {
    // B lands mid-row, so it gets no button. That is the current behavior of an index
    // built from row.items[0], not an accident of the fixture.
    const albums = [
      album({ id: "srv-a:a0", name: "A one" }),
      album({ id: "srv-a:a1", name: "A two" }),
      album({ id: "srv-a:b0", name: "B one" }),
      album({ id: "srv-a:b1", name: "B two" }),
      album({ id: "srv-a:c0", name: "C one" }),
    ];
    renderGrid({ albums, sort: "alphabetical" });
    expect(scrubberLabels()).toEqual(["A", "C"]);
  });

  it("buckets year sections by decade, keeping the first year of each", () => {
    const albums = [1993, 1997, 2004, 2011].map((year, i) =>
      album({ id: `srv-a:${i}`, name: `Album ${i}`, year })
    );
    renderGrid({ albums, sort: "year" });
    expect(scrubberLabels()).toEqual(["1990s", "2000s", "2010s"]);
  });

  it("passes an unparseable year label through as its own section", () => {
    const albums = [
      album({ id: "srv-a:1", name: "One", year: null }),
      album({ id: "srv-a:2", name: "Two", year: 1993 }),
    ];
    renderGrid({ albums, sort: "year" });
    expect(scrubberLabels()).toEqual(["Unknown", "1990s"]);
  });
});

describe("AlbumGrid scrubber jump", () => {
  // 8 albums per letter over 4 columns = exactly 2 rows per letter, so letter i's section
  // is row 2i and its expected scroll offset is a plain multiple of the row pitch.
  const perLetter = COLS * 2;

  function expectedTop(rowIndex: number) {
    return PADDING + rowIndex * ROW_H;
  }

  /** Clicks a scrubber button and returns the single scroll offset it produced. The spy is
   *  cleared first because the virtualizer re-applies its pending scroll on every render,
   *  and only the click's own scroll is under test here. */
  function jumpTo(label: string): number {
    scrollTo.mockClear();
    clickScrubber(label);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    return (scrollTo.mock.calls[0]![0] as { top: number }).top;
  }

  it("scrolls a mid-alphabet section flush with the top of the viewport", () => {
    renderGrid({ albums: lettered(ALPHABET, perLetter), sort: "alphabetical" });
    expect(jumpTo("L")).toBe(expectedTop(22));
  });

  it("lands the jumped-to row exactly where the grid paints it", () => {
    // Implementation-independent framing of the same property: whatever offset the grid
    // paints a row at, that is the offset the scrubber must scroll to. This is the half
    // that survives a change to how the padding is applied.
    renderGrid({ albums: lettered(ALPHABET, perLetter), sort: "alphabetical" });
    const target = jumpTo("C");
    const scroller = document.querySelector<HTMLElement>(".album-grid-scroller")!;
    act(() => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: target });
      scroller.dispatchEvent(new Event("scroll"));
    });
    const painted = gridRows().map((r) => parseInt(r.style.top, 10));
    expect(painted).toContain(target);
  });

  it("scrolls the first section to the grid padding, not to zero", () => {
    // Off-by-PADDING shows up here as top: 0, which reads as correct until the first row
    // sits 20px under the top edge.
    renderGrid({ albums: lettered(ALPHABET, perLetter), sort: "alphabetical" });
    expect(jumpTo("A")).toBe(expectedTop(0));
  });

  it("accounts for year headers when jumping in year sort", () => {
    // Rows are [header, 8 album rows] per year, so the third decade's header is row 18 and
    // the offset mixes two different estimateSize values. 32 albums per year keeps the
    // target well clear of the bottom clamp, which would otherwise answer the question.
    const perYear = COLS * 8;
    const albums = [1990, 2000, 2010].flatMap((year, y) =>
      Array.from({ length: perYear }, (_, i) =>
        album({ id: `srv-a:${y}-${i}`, name: `Album ${y}-${i}`, year })
      )
    );
    renderGrid({ albums, sort: "year" });
    expect(jumpTo("2010s")).toBe(PADDING + 2 * YEAR_HEADER_HEIGHT + 16 * ROW_H);
  });

  it("can reach the last section's row", () => {
    // The last section is past the bottom of the scroll range, so the jump clamps to the
    // scroller's own scrollHeight - clientHeight. Pins that the padding counted into the
    // sizing div is the same padding the clamp is taken against.
    const albums = lettered(ALPHABET, perLetter);
    renderGrid({ albums, sort: "alphabetical" });
    const rowCount = albums.length / COLS;
    const totalHeight = rowCount * ROW_H + PADDING * 2;
    expect(jumpTo("Z")).toBe(Math.min(expectedTop(50), totalHeight - HEIGHT));
  });
});

describe("AlbumGrid card interaction", () => {
  it("opens an album on click and on Enter, and ignores other keys", () => {
    renderGrid({ albums: lettered(["A"], 1) });
    const card = cards()[0]!;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("loves an album without also opening it", () => {
    renderGrid({ albums: lettered(["A"], 1) });
    fireEvent.click(screen.getByLabelText("Love album"));
    expect(toggleAlbumLove).toHaveBeenCalledTimes(1);
    expect(toggleAlbumLove.mock.calls[0]![0]).toBe("srv-a:A0");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("labels the heart by loved state", () => {
    lovedAlbumIds.add("srv-a:A0");
    renderGrid({ albums: lettered(["A"], 1) });
    expect(screen.getByLabelText("Unlove album")).toBeInTheDocument();
  });

  it("renders a placeholder rather than an image when an album has no artwork", () => {
    renderGrid({ albums: lettered(["A"], 1) });
    expect(document.querySelector(".album-art--placeholder")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("AlbumGrid context menu", () => {
  function openMenu() {
    fireEvent.contextMenu(cards()[0]!, { clientX: 10, clientY: 20 });
    const menu = document.querySelector<HTMLElement>(".context-menu");
    if (!menu) throw new Error("context menu did not open");
    return within(menu);
  }

  it("offers only the always-available actions when no optional handlers are passed", () => {
    renderGrid({ albums: lettered(["A"], 1) });
    const menu = openMenu();
    expect(menu.getByText("Open album")).toBeInTheDocument();
    expect(menu.getByText("Love album")).toBeInTheDocument();
    expect(menu.getByText("Identify on MusicBrainz…")).toBeInTheDocument();
    expect(menu.queryByText("Add to Queue")).not.toBeInTheDocument();
    expect(menu.queryByText("Add to Playlist")).not.toBeInTheDocument();
  });

  it("adds an album to the queue and closes", () => {
    const onAddAlbumToQueue = vi.fn();
    renderGrid({ albums: lettered(["A"], 1), onAddAlbumToQueue });
    fireEvent.click(openMenu().getByText("Add to Queue"));
    expect(onAddAlbumToQueue).toHaveBeenCalledTimes(1);
    expect(onAddAlbumToQueue.mock.calls[0]![0].id).toBe("srv-a:A0");
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("hides the playlist submenu when the playlist list is empty", () => {
    renderGrid({ albums: lettered(["A"], 1), onAddAlbumToPlaylist: vi.fn(), playlists: [] });
    expect(openMenu().queryByText(/Add to Playlist/)).not.toBeInTheDocument();
  });

  it("shows the playlist submenu once there is a playlist", () => {
    const onAddAlbumToPlaylist = vi.fn();
    renderGrid({
      albums: lettered(["A"], 1),
      onAddAlbumToPlaylist,
      playlists: [{ id: "pl1", name: "Roadtrip" } as never],
    });
    expect(openMenu().getByText(/Add to Playlist/)).toBeInTheDocument();
  });

  it("flips the love entry to unlove for a loved album", () => {
    lovedAlbumIds.add("srv-a:A0");
    renderGrid({ albums: lettered(["A"], 1) });
    expect(openMenu().getByText("Unlove album")).toBeInTheDocument();
  });
});

describe("AlbumGrid pagination", () => {
  it("shows no pagination bar for a library at the page size", () => {
    settings.set("albums.pagination", "true");
    renderGrid({ albums: lettered(ALPHABET, 4).slice(0, 100), sort: "alphabetical" });
    expect(document.querySelector(".album-grid-pagination")).toBeNull();
  });

  it("paginates a library past the page size and hides the scrubber", () => {
    settings.set("albums.pagination", "true");
    renderGrid({ albums: lettered(ALPHABET, 8), sort: "alphabetical" });
    expect(document.querySelector(".album-grid-pagination")).not.toBeNull();
    expect(document.querySelector(".album-grid-scrubber")).toBeNull();
    // Only the first page is chunked into rows, so the last visible card comes from it.
    expect(cardNames()[0]).toBe("A album 0");
  });

  it("renders every album and no pagination when pagination is off", () => {
    renderGrid({ albums: lettered(ALPHABET, 8), sort: "alphabetical" });
    expect(document.querySelector(".album-grid-pagination")).toBeNull();
    expect(document.querySelector(".album-grid-scrubber")).not.toBeNull();
  });
});
