// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

// useLoved is mocked at the hook rather than at the db/network boundary on purpose: the
// only loved behavior this file cares about is that the heart button does not also select
// or play the row. Letting the real hook run would drag a Subsonic star request into every
// selection test for no assertion.
const lovedTrackIds = new Set<string>();
const toggleTrackLove = vi.fn();
vi.mock("../hooks/useLoved", () => ({
  useLoved: () => ({ lovedTrackIds, toggleTrackLove }),
}));

import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrackTableView } from "./TrackTableView";
import { usePlayerStore } from "../store/player";
import { getDb } from "../db";
import { createMigratedTestDb } from "../test/sqlite";
import { resetTauriMocks, onInvoke } from "../test/mocks/tauri";
import type { AllTrackRow } from "../hooks/useAllTracks";
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

function track(over: Partial<AllTrackRow> & { id: string; title: string }): AllTrackRow {
  return {
    artist: null,
    album_artist: null,
    album_id: "srv-a:al1",
    album_name: null,
    album_artwork_url: null,
    genre: null,
    track_number: null,
    disc_number: null,
    year: null,
    duration: null,
    play_count: null,
    bit_rate: null,
    suffix: null,
    replay_gain_track_gain: null,
    replay_gain_track_peak: null,
    replay_gain_album_gain: null,
    replay_gain_album_peak: null,
    ...over,
  };
}

// Default sort is artist ascending, so the artist letter fixes the visible row order
// independently of the array order handed in as a prop.
function row(letter: string): AllTrackRow {
  return track({ id: `srv-a:t${letter}`, title: `Song ${letter}`, artist: `Artist ${letter}` });
}

const FIVE = ["A", "B", "C", "D", "E"].map(row);

const playQueue = vi.fn();
const addToQueue = vi.fn();
const playNext = vi.fn();
const addManyToQueue = vi.fn();
const playNextMany = vi.fn();
const startRadio = vi.fn();

function renderTable(props: Partial<React.ComponentProps<typeof TrackTableView>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    serverWithCredential: SRV,
    tracks: FIVE,
    isLoading: false,
    ...props,
  } as React.ComponentProps<typeof TrackTableView>;
  const view = render(
    <QueryClientProvider client={client}>
      <TrackTableView {...all} />
    </QueryClientProvider>
  );
  return {
    ...view,
    rerenderWith: (tracks: AllTrackRow[] | undefined) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <TrackTableView {...all} tracks={tracks} />
        </QueryClientProvider>
      ),
  };
}

/** Visible rows, in render order. */
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".playlist-vrow"));
}

function rowTitles(): string[] {
  return rows().map((r) => r.querySelector(".playlist-vrow-title")!.textContent!);
}

/**
 * Header lookups go through the DOM rather than `getByRole`: computing an accessible name
 * walks the whole tree, and at ~8 sort headers it made these the slowest cases in the file
 * (2.3s for the all-columns loop), which timed out under full-suite load. The selector keeps
 * the "this is a real button" half of what the role query was checking.
 */
function querySortHeader(label: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("button.track-sort-btn")).find((b) =>
      (b.textContent ?? "").trimStart().startsWith(label)
    ) ?? null
  );
}

function sortHeader(label: string): HTMLElement {
  const found = querySortHeader(label);
  if (!found) throw new Error(`no sort header for ${label}`);
  return found;
}

function rowFor(title: string): HTMLElement {
  const found = rows().find((r) => r.querySelector(".playlist-vrow-title")!.textContent === title);
  if (!found) throw new Error(`no row titled ${title}; have ${rowTitles().join(", ")}`);
  return found;
}

function selectedTitles(): string[] {
  return rows()
    .filter((r) => r.classList.contains("track-table-row--selected"))
    .map((r) => r.querySelector(".playlist-vrow-title")!.textContent!);
}

beforeAll(() => {
  // @tanstack/react-virtual's calculateRange returns null when the scroll element measures
  // 0px, and jsdom reports 0 for every element. Without a height every row is virtualized
  // away and a selection assertion would pass against an empty list.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 900 });
});

beforeEach(async () => {
  resetTauriMocks();
  localStorage.clear();
  lovedTrackIds.clear();
  toggleTrackLove.mockClear();
  for (const fn of [playQueue, addToQueue, playNext, addManyToQueue, playNextMany, startRadio]) fn.mockClear();
  usePlayerStore.setState({
    playQueue, addToQueue, playNext, addManyToQueue, playNextMany, startRadio,
    currentTrack: null, isPlaying: false,
  });
  onInvoke("get_loved", () => ({ trackIds: [], albumIds: [], trackAlbumIds: [] }));
  const db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
});

afterEach(cleanup);

describe("TrackTableView load / empty / error states", () => {
  it("shows the empty state and no header count when tracks are undefined", () => {
    renderTable({ tracks: undefined });
    expect(screen.getByText("No tracks yet")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the empty state with a zero count for an empty library", () => {
    renderTable({ tracks: [] });
    expect(screen.getByText("No tracks yet")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders skeletons rather than the error state while loading", () => {
    renderTable({ tracks: undefined, isLoading: true, error: "boom" });
    const skeletons = screen.getByLabelText("Loading tracks");
    expect(skeletons).toHaveAttribute("aria-busy", "true");
    expect(skeletons.querySelectorAll(".track-skeleton-row")).toHaveLength(14);
    expect(screen.queryByText("Couldn't load your tracks")).not.toBeInTheDocument();
  });

  it("renders the error state with a working retry", () => {
    const onRetry = vi.fn();
    renderTable({ tracks: undefined, error: "network down", onRetry });
    expect(screen.getByText("network down")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("distinguishes loading, error and empty from a loaded list", () => {
    const { rerenderWith, unmount } = renderTable();
    expect(rowTitles()).toEqual(["Song A", "Song B", "Song C", "Song D", "Song E"]);
    rerenderWith([]);
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("No tracks yet")).toBeInTheDocument();
    unmount();
  });
});

describe("TrackTableView sorting", () => {
  it("sorts by artist ascending by default", () => {
    renderTable({ tracks: [row("C"), row("A"), row("B")] });
    expect(rowTitles()).toEqual(["Song A", "Song B", "Song C"]);
  });

  it("sorts by a clicked column and flips direction on a second click", () => {
    renderTable({
      tracks: [
        track({ id: "srv-a:t1", title: "Zulu", artist: "Artist A" }),
        track({ id: "srv-a:t2", title: "Alpha", artist: "Artist B" }),
      ],
    });
    fireEvent.click(sortHeader("Title"));
    expect(rowTitles()).toEqual(["Alpha", "Zulu"]);
    fireEvent.click(sortHeader("Title"));
    expect(rowTitles()).toEqual(["Zulu", "Alpha"]);
  });

  it("sorts every clickable numeric and string column", () => {
    localStorage.setItem(
      "canon-track-table-cols",
      JSON.stringify({ artist: true, album: true, year: true, genre: false, duration: true, plays: true, format: true, bitrate: true })
    );
    const lo = track({ id: "srv-a:t1", title: "Low", artist: "Artist B", album_name: "Beta", year: 1990, duration: 100, play_count: 1, bit_rate: 128, suffix: "flac" });
    const hi = track({ id: "srv-a:t2", title: "High", artist: "Artist A", album_name: "Alpha", year: 2020, duration: 300, play_count: 9, bit_rate: 320, suffix: "mp3" });
    renderTable({ tracks: [lo, hi] });
    const cases: Array<[string, string[]]> = [
      ["Title", ["High", "Low"]],
      ["Artist", ["High", "Low"]],
      ["Album", ["High", "Low"]],
      ["Year", ["Low", "High"]],
      ["Format", ["Low", "High"]],
      ["Bitrate", ["Low", "High"]],
      ["Plays", ["Low", "High"]],
      ["Duration", ["Low", "High"]],
    ];
    for (const [name, expected] of cases) {
      fireEvent.click(sortHeader(name));
      expect(rowTitles(), `ascending sort for ${name}`).toEqual(expected);
    }
  });

  it("keeps null values last in both sort directions", () => {
    localStorage.setItem("canon-track-table-cols", JSON.stringify({ year: true }));
    renderTable({
      tracks: [
        track({ id: "srv-a:t1", title: "NoYear", artist: "Artist A", year: null }),
        track({ id: "srv-a:t2", title: "Old", artist: "Artist B", year: 1970 }),
        track({ id: "srv-a:t3", title: "New", artist: "Artist C", year: 2020 }),
      ],
    });
    fireEvent.click(sortHeader("Year"));
    expect(rowTitles()).toEqual(["Old", "New", "NoYear"]);
    fireEvent.click(sortHeader("Year"));
    expect(rowTitles()).toEqual(["New", "Old", "NoYear"]);
  });

  it("does not offer a sort control for the genre column", () => {
    localStorage.setItem("canon-track-table-cols", JSON.stringify({ genre: true }));
    renderTable();
    expect(screen.getByText("Genre").tagName).toBe("SPAN");
    // Positive control: a null answer for Genre must mean "no such header", not "the
    // selector matches nothing".
    expect(querySortHeader("Title")).not.toBeNull();
    expect(querySortHeader("Genre")).toBeNull();
  });

  it("clears the selection when the sort changes", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    expect(selectedTitles()).toEqual(["Song B"]);
    fireEvent.click(sortHeader("Title"));
    expect(selectedTitles()).toEqual([]);
  });
});

describe("TrackTableView selection", () => {
  it("plays from the clicked row on a plain click and clears the selection", () => {
    renderTable();
    fireEvent.click(rowFor("Song C"), { ctrlKey: true });
    fireEvent.click(rowFor("Song A"));
    expect(selectedTitles()).toEqual([]);
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect(playQueue.mock.calls[0]![2]).toBe(0);
  });

  it("selects without playing on a ctrl-click and toggles the same row off", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    expect(selectedTitles()).toEqual(["Song B"]);
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    expect(selectedTitles()).toEqual([]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("treats meta-click as ctrl-click", () => {
    renderTable();
    fireEvent.click(rowFor("Song D"), { metaKey: true });
    expect(selectedTitles()).toEqual(["Song D"]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("selects the inclusive range from the anchor on a shift-click", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.click(rowFor("Song D"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song B", "Song C", "Song D"]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("selects the same range when shift-clicking backwards", () => {
    renderTable();
    fireEvent.click(rowFor("Song D"), { ctrlKey: true });
    fireEvent.click(rowFor("Song B"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song B", "Song C", "Song D"]);
  });

  it("unions successive shift-clicks rather than replacing the range", () => {
    renderTable();
    fireEvent.click(rowFor("Song A"), { ctrlKey: true });
    fireEvent.click(rowFor("Song B"), { shiftKey: true });
    fireEvent.click(rowFor("Song D"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song A", "Song B", "Song C", "Song D"]);
  });

  it("selects only the clicked row and does not play when shift-clicking with no anchor", () => {
    renderTable();
    fireEvent.click(rowFor("Song C"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song C"]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("anchors a no-anchor shift-click so the next shift-click ranges from it", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { shiftKey: true });
    fireEvent.click(rowFor("Song D"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song B", "Song C", "Song D"]);
  });

  it("clears the selection on Escape", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(selectedTitles()).toEqual([]);
  });

  it("plays from the focused row on Enter", () => {
    renderTable();
    fireEvent.keyDown(rowFor("Song D"), { key: "Enter" });
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect(playQueue.mock.calls[0]![2]).toBe(3);
  });

  it("does nothing for keys the table does not handle", () => {
    renderTable();
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", " "]) {
      fireEvent.keyDown(rowFor("Song A"), { key });
    }
    expect(playQueue).not.toHaveBeenCalled();
    expect(selectedTitles()).toEqual([]);
  });
});

describe("TrackTableView selection across a refresh", () => {
  it("keeps the same tracks selected when a refresh reorders the rows", () => {
    const { rerenderWith } = renderTable();
    fireEvent.click(rowFor("Song C"), { ctrlKey: true });
    fireEvent.click(rowFor("Song D"), { ctrlKey: true });
    expect(selectedTitles()).toEqual(["Song C", "Song D"]);

    // A sync renames an artist, so C and D move to the top of the artist-ascending order.
    rerenderWith([
      row("A"), row("B"), row("E"),
      { ...row("C"), artist: "Artist 1" },
      { ...row("D"), artist: "Artist 2" },
    ]);
    expect(rowTitles()).toEqual(["Song C", "Song D", "Song A", "Song B", "Song E"]);
    expect(selectedTitles()).toEqual(["Song C", "Song D"]);
  });

  it("keeps the surviving selection when a refresh drops a selected track", () => {
    const { rerenderWith } = renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.click(rowFor("Song D"), { ctrlKey: true });
    rerenderWith([row("A"), row("C"), row("D"), row("E")]);
    expect(selectedTitles()).toEqual(["Song D"]);
  });

  it("keeps the selection when the tracks array identity changes but its content does not", () => {
    const { rerenderWith } = renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    rerenderWith([...FIVE]);
    expect(selectedTitles()).toEqual(["Song B"]);
  });

  it("ranges from the anchored track's new position after a refresh inserts rows above it", () => {
    const { rerenderWith } = renderTable();
    fireEvent.click(rowFor("Song A"), { ctrlKey: true });
    // A sync adds a track that sorts ahead of everything: the anchor is still Song A,
    // now at index 1. An index-keyed anchor would range from the new row instead.
    rerenderWith([track({ id: "srv-a:tz", title: "Song Z", artist: "Artist 0" }), ...FIVE]);
    expect(rowTitles()[0]).toBe("Song Z");
    fireEvent.click(rowFor("Song C"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song A", "Song B", "Song C"]);
  });

  it("treats a shift-click as anchorless when the anchored track is gone", () => {
    const { rerenderWith } = renderTable();
    fireEvent.click(rowFor("Song A"), { ctrlKey: true });
    rerenderWith([row("B"), row("C"), row("D"), row("E")]);
    fireEvent.click(rowFor("Song C"), { shiftKey: true });
    expect(selectedTitles()).toEqual(["Song C"]);
    expect(playQueue).not.toHaveBeenCalled();
  });
});

describe("TrackTableView context menu", () => {
  function openMenuOn(title: string) {
    fireEvent.contextMenu(rowFor(title), { clientX: 10, clientY: 10 });
    return within(document.querySelector<HTMLElement>(".context-menu")!);
  }

  it("opens the single-track menu for a row outside the selection", () => {
    renderTable({ onSelectAlbum: vi.fn(), onSelectArtist: vi.fn() });
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.click(rowFor("Song C"), { ctrlKey: true });
    const menu = openMenuOn("Song E");
    expect(menu.getByText("Play Now")).toBeInTheDocument();
    expect(menu.getByText("Go to Album")).toBeInTheDocument();
    expect(menu.getByText("Go to Artist")).toBeInTheDocument();
    expect(selectedTitles()).toEqual(["Song B", "Song C"]);
  });

  it("opens the bulk menu for a row inside a multi-row selection", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.click(rowFor("Song C"), { ctrlKey: true });
    const menu = openMenuOn("Song C");
    expect(menu.getByText("Play 2 tracks")).toBeInTheDocument();
    fireEvent.click(menu.getByText("Play 2 tracks"));
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect((playQueue.mock.calls[0]![0] as Array<{ title: string }>).map((t) => t.title))
      .toEqual(["Song B", "Song C"]);
  });

  it("opens the single-track menu when only one row is selected", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    const menu = openMenuOn("Song B");
    expect(menu.getByText("Play Now")).toBeInTheDocument();
    expect(menu.queryByText(/Play \d+ tracks/)).not.toBeInTheDocument();
  });

  it("opens the single-track menu when a refresh leaves only one selected row in view", () => {
    const { rerenderWith } = renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.click(rowFor("Song D"), { ctrlKey: true });
    rerenderWith([row("A"), row("C"), row("D"), row("E")]);
    const menu = openMenuOn("Song D");
    expect(menu.queryByText(/Play \d+ tracks/)).not.toBeInTheDocument();
    expect(menu.getByText("Play Now")).toBeInTheDocument();
  });

  it("hides the navigation items when their callbacks are absent", () => {
    renderTable();
    const menu = openMenuOn("Song B");
    expect(menu.queryByText("Go to Album")).not.toBeInTheDocument();
    expect(menu.queryByText("Go to Artist")).not.toBeInTheDocument();
  });

  it("hides Go to Artist for a track with no artist", () => {
    renderTable({
      tracks: [track({ id: "srv-a:t1", title: "Orphan", artist: null })],
      onSelectAlbum: vi.fn(),
      onSelectArtist: vi.fn(),
    });
    const menu = openMenuOn("Orphan");
    expect(menu.getByText("Go to Album")).toBeInTheDocument();
    expect(menu.queryByText("Go to Artist")).not.toBeInTheDocument();
  });

  it("plays the right-clicked track from its own position", () => {
    renderTable();
    const menu = openMenuOn("Song D");
    fireEvent.click(menu.getByText("Play Now"));
    expect(playQueue.mock.calls[0]![2]).toBe(3);
  });

  it("clears the selection from the bulk menu", () => {
    renderTable();
    fireEvent.click(rowFor("Song B"), { ctrlKey: true });
    fireEvent.click(rowFor("Song C"), { ctrlKey: true });
    const menu = openMenuOn("Song B");
    fireEvent.click(menu.getByText("Clear selection"));
    expect(selectedTitles()).toEqual([]);
  });
});

describe("TrackTableView row controls", () => {
  it("toggles love without selecting or playing the row", () => {
    renderTable();
    fireEvent.click(within(rowFor("Song B")).getByLabelText("Love track"));
    expect(toggleTrackLove).toHaveBeenCalledTimes(1);
    expect(toggleTrackLove.mock.calls[0]![0]).toBe("srv-a:tB");
    expect(selectedTitles()).toEqual([]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("falls back to the default columns when the stored column config is corrupt", () => {
    localStorage.setItem("canon-track-table-cols", "{{{");
    renderTable();
    expect(sortHeader("Artist")).toBeInTheDocument();
    expect(querySortHeader("Year")).not.toBeInTheDocument();
  });

  it("persists a column toggle", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("Show/hide columns"));
    fireEvent.click(screen.getByLabelText("Year"));
    expect(sortHeader("Year")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("canon-track-table-cols")!).year).toBe(true);
  });
});
