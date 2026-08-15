// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SmartPlaylistModal } from "./SmartPlaylistModal";
import {
  DEFAULT_SMART_FILTERS,
  parseSmartFilters,
  buildSmartQuery,
  LIMIT_MAX,
  type SmartFilters,
} from "../lib/smartPlaylist";
import { useGenresSessionStore } from "../store/genresSessionStore";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { invokeCount } from "../test/perf";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

/**
 * What this component actually is, because the plan bullet's wording does not describe it:
 * there is no rule list, no add/remove rule, no per-rule field/operator/value triple. It is a
 * fixed-shape form over the 11 named fields of `SmartFilters`, and the only add/remove surface
 * is the genre chips. It also never imports `parseSmartFilters` or `buildSmartQuery` - the
 * callers parse `rules_json` into `initialFilters` (`PlaylistList.tsx`, `PlaylistDetail.tsx`)
 * and feed `onSave`'s argument to `buildSmartQuery` (`usePlaylists.ts`). So the round-trip this
 * file proves is: a `parseSmartFilters` output survives mount -> edit -> save and is still a
 * `buildSmartQuery` input that selects the tracks it selected before.
 *
 * `smartPlaylist.test.ts` owns the unit level (every parse branch, LIKE escaping, every
 * SORT_OPTIONS value producing valid SQL). Nothing here re-tests that; the SQL assertions below
 * exist only to prove the modal hands over field values that function still accepts.
 */

// useGenres is not React Query: it is a zustand session store plus `invoke("get_genres")` after
// `await getDb()`, and it caches rows at module scope keyed by refreshTick. Without the reset
// below, test 1's fetch is reused by every later test and `invoke` is never called again.
function resetGenresCache() {
  useGenresSessionStore.setState({
    refreshTick: 0,
    rows: undefined,
    cachedTick: -1,
    recentRows: undefined,
    recentCachedTick: -1,
  });
}

interface Genre {
  canonical_id: string;
  name: string;
  album_count: number;
}

const GENRES: Genre[] = [
  { canonical_id: "rock", name: "Rock", album_count: 12 },
  { canonical_id: "jazz", name: "Jazz", album_count: 7 },
  { canonical_id: "post-rock", name: "Post-Rock", album_count: 3 },
];

/** Mounts the modal and flushes the genre fetch. The portal lands on document.body. */
async function mount(props: Partial<React.ComponentProps<typeof SmartPlaylistModal>> = {}) {
  const onSave = props.onSave ?? vi.fn(async () => {});
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <SmartPlaylistModal {...props} onSave={onSave} onClose={onClose} />
  );
  await act(async () => {});
  return { ...utils, onSave: onSave as ReturnType<typeof vi.fn>, onClose: onClose as ReturnType<typeof vi.fn> };
}

/**
 * The labels are plain divs with no `htmlFor`, so `getByLabelText` cannot reach these inputs.
 * Resolving through the `.spm-field` wrapper keeps the tests readable without asserting on
 * DOM order, which would silently repoint if a field is inserted.
 */
function field(label: string): HTMLInputElement | HTMLSelectElement {
  const el = Array.from(document.querySelectorAll(".spm-label")).find(
    (l) => l.textContent === label
  );
  if (!el) throw new Error(`no field labelled "${label}"`);
  const input = el.parentElement!.querySelector("input, select");
  if (!input) throw new Error(`field "${label}" has no control`);
  return input as HTMLInputElement | HTMLSelectElement;
}

/** The filters `onSave` was called with, asserted present so the tests read as assertions. */
function savedFilters(onSave: ReturnType<typeof vi.fn>, call = 0): SmartFilters {
  const args = onSave.mock.calls[call];
  if (!args) throw new Error(`onSave was not called ${call + 1} time(s)`);
  return args[0] as SmartFilters;
}

const saveBtn = () => screen.getByRole("button", { name: /Create|Save & Refresh|Saving/ });
const cancelBtn = () => screen.getByRole("button", { name: "Cancel" });
const closeBtn = () => screen.getByRole("button", { name: "Close" });
const overlay = () => document.querySelector(".spm-overlay") as HTMLElement;
const dialog = () => document.querySelector(".spm-dialog") as HTMLElement;
const selectedChips = () =>
  Array.from(document.querySelectorAll(".spm-genre-chip--selected")).map((c) =>
    (c.textContent ?? "").trim()
  );
const availableChips = () =>
  Array.from(document.querySelectorAll(".spm-genre-chip:not(.spm-genre-chip--selected)")).map(
    (c) => (c.textContent ?? "").trim()
  );

function type(control: HTMLInputElement | HTMLSelectElement, value: string) {
  fireEvent.change(control, { target: { value } });
}

/** A realistic saved row, as `parseSmartFilters` would hand it back. */
const SAVED_RULES = JSON.stringify({
  name: "Seventies Rock",
  limit: 25,
  sort: "-year",
  artistContains: "Zeppelin",
  albumContains: "",
  titleContains: "",
  selectedGenres: ["rock"],
  genreMode: "include",
  yearFrom: 1970,
  yearTo: 1979,
  minPlayCount: 3,
});

beforeEach(() => {
  resetTauriMocks();
  resetGenresCache();
  onInvoke("get_genres", () => GENRES);
});

afterEach(() => {
  cleanup();
});

describe("SmartPlaylistModal round-trip", () => {
  it("hands back a parsed rules_json unchanged when nothing is edited", async () => {
    const initial = parseSmartFilters(SAVED_RULES)!;
    const { onSave } = await mount({ initialFilters: initial, title: "Edit Smart Playlist" });

    fireEvent.click(saveBtn());
    await act(async () => {});

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(savedFilters(onSave)).toEqual(initial);
  });

  it("prefills every field from initialFilters", async () => {
    const initial = parseSmartFilters(SAVED_RULES)!;
    await mount({ initialFilters: initial, title: "Edit Smart Playlist" });

    expect((field("Name") as HTMLInputElement).value).toBe("Seventies Rock");
    expect((field("Limit") as HTMLInputElement).value).toBe("25");
    expect((field("Sort") as HTMLSelectElement).value).toBe("-year");
    expect((field("Artist contains") as HTMLInputElement).value).toBe("Zeppelin");
    expect((field("Year from") as HTMLInputElement).value).toBe("1970");
    expect((field("Year to") as HTMLInputElement).value).toBe("1979");
    expect((field("Min play count") as HTMLInputElement).value).toBe("3");
    expect(selectedChips()).toEqual(["Rock"]);
  });

  it("saves a payload that still selects the same tracks through buildSmartQuery", async () => {
    const db: FakeDatabase = await createMigratedTestDb();
    db.raw
      .prepare(
        `INSERT INTO albums (id, server_id, server_type, name, artist) VALUES ('al-1','srv-a','navidrome','Album','Zeppelin')`
      )
      .run();
    db.raw
      .prepare(
        `INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES ('al-1','rock','direct','Rock')`
      )
      .run();
    const track = (id: string, year: number, plays: number) =>
      db.raw
        .prepare(
          `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, year, play_count) VALUES (?,'srv-a','navidrome',?, 'Zeppelin','al-1',?,?)`
        )
        .run(id, `T ${id}`, year, plays);
    track("t-in", 1975, 9);
    track("t-oldyear", 1965, 9);
    track("t-lowplays", 1975, 1);

    const initial = parseSmartFilters(SAVED_RULES)!;
    const { onSave } = await mount({ initialFilters: initial, title: "Edit Smart Playlist" });
    fireEvent.click(saveBtn());
    await act(async () => {});

    const { sql, params } = buildSmartQuery(savedFilters(onSave), "srv-a");
    const rows = await db.select<{ id: string }[]>(sql, params);
    expect(rows.map((r) => r.id)).toEqual(["t-in"]);
    await db.close();
  });

  it("keeps a legacy row's missing fields at their defaults and still saves them", async () => {
    const initial = parseSmartFilters('{"name":"Old"}')!;
    const { onSave } = await mount({ initialFilters: initial, title: "Edit Smart Playlist" });

    expect((field("Limit") as HTMLInputElement).value).toBe("50");
    expect((field("Sort") as HTMLSelectElement).value).toBe("+random");
    expect(document.querySelector(".spm-genre-selected")).toBeNull();

    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave)).toEqual({ ...DEFAULT_SMART_FILTERS, name: "Old" });
  });

  it("renders a selected genre id absent from the genre list as the raw id, and round-trips it", async () => {
    const initial: SmartFilters = {
      ...DEFAULT_SMART_FILTERS,
      name: "Legacy",
      selectedGenres: ["genre-that-vanished"],
    };
    const { onSave } = await mount({ initialFilters: initial, title: "Edit Smart Playlist" });

    expect(selectedChips()).toEqual(["genre-that-vanished"]);
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).selectedGenres).toEqual([
      "genre-that-vanished",
    ]);
  });

  it("preserves a sort value that is not in SORT_OPTIONS even though the select shows Random", async () => {
    // Nothing validates `sort`: parseSmartFilters repairs genreMode and name but not this, and
    // a <select> whose value matches no <option> displays the first one. The UI therefore says
    // Random while the state still holds the unknown value, and saving re-persists it.
    const initial: SmartFilters = { ...DEFAULT_SMART_FILTERS, name: "Odd", sort: "+bpm" };
    const { onSave } = await mount({ initialFilters: initial, title: "Edit Smart Playlist" });

    expect((field("Sort") as HTMLSelectElement).value).toBe("+random");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).sort).toBe("+bpm");
  });
});

describe("SmartPlaylistModal save gating", () => {
  it("disables save when the name is empty at mount", async () => {
    await mount();
    expect(saveBtn()).toBeDisabled();
  });

  it("disables save for a whitespace-only name", async () => {
    await mount();
    type(field("Name"), "   ");
    expect(saveBtn()).toBeDisabled();
  });

  it("enables save once a name is typed and re-disables when it is cleared", async () => {
    await mount();
    type(field("Name"), "Mix");
    expect(saveBtn()).toBeEnabled();
    type(field("Name"), "");
    expect(saveBtn()).toBeDisabled();
  });

  it("trims the name before handing it to onSave", async () => {
    const { onSave } = await mount();
    type(field("Name"), "  Mix  ");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).name).toBe("Mix");
  });

  it("leaves save enabled for every other field, however nonsensical", async () => {
    // The name is the only validation input. A reversed year range, a zero limit and empty
    // text filters all save happily; the query just returns nothing.
    await mount();
    type(field("Name"), "Mix");
    type(field("Year from"), "2020");
    type(field("Year to"), "1970");
    type(field("Min play count"), "0");
    expect(saveBtn()).toBeEnabled();
  });

  it("disables save and cancel while the save is in flight", async () => {
    let release!: () => void;
    const onSave = vi.fn(() => new Promise<void>((r) => (release = r)));
    await mount({ onSave });
    type(field("Name"), "Mix");
    fireEvent.click(saveBtn());
    await act(async () => {});

    expect(saveBtn()).toBeDisabled();
    expect(cancelBtn()).toBeDisabled();
    expect(saveBtn().textContent).toContain("Saving");

    await act(async () => {
      release();
    });
  });

  it("closes exactly once after a successful save", async () => {
    const { onSave, onClose } = await mount();
    type(field("Name"), "Mix");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open with no visible error when onSave rejects", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onSave = vi.fn(async () => {
      throw new Error("network down");
    });
    const { onClose } = await mount({ onSave });
    type(field("Name"), "Mix");
    fireEvent.click(saveBtn());
    await act(async () => {});

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(saveBtn()).toBeEnabled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("SmartPlaylistModal genre selection", () => {
  it("moves a genre from the available list into the selected chips", async () => {
    await mount();
    expect(availableChips()).toEqual(["Rock", "Jazz", "Post-Rock"]);

    fireEvent.click(screen.getByRole("button", { name: "Jazz" }));

    expect(selectedChips()).toEqual(["Jazz"]);
    expect(availableChips()).toEqual(["Rock", "Post-Rock"]);
  });

  it("returns to the empty state when the selected chip is clicked again", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    fireEvent.click(screen.getByRole("button", { name: "Jazz" }));
    fireEvent.click(document.querySelector(".spm-genre-chip--selected") as HTMLElement);

    expect(document.querySelector(".spm-genre-selected")).toBeNull();
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).selectedGenres).toEqual([]);
  });

  it("omits the selected-chip container entirely when nothing is selected", async () => {
    await mount();
    expect(document.querySelector(".spm-genre-selected")).toBeNull();
  });

  it("filters the genre list case-insensitively and ignores surrounding whitespace", async () => {
    await mount();
    type(document.querySelector(".spm-genre-search") as HTMLInputElement, "  ROCK ");
    expect(availableChips()).toEqual(["Rock", "Post-Rock"]);
  });

  it("shows the empty message when the search matches nothing, keeping the chips visible", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Jazz" }));
    type(document.querySelector(".spm-genre-search") as HTMLInputElement, "zzzz");

    expect(screen.getByText("No genres found")).toBeInTheDocument();
    expect(selectedChips()).toEqual(["Jazz"]);
  });

  it("shows the same empty message whether the library has no genres or they are still loading", async () => {
    // Both states render "No genres found"; the component has no loading branch. Pinned as a
    // known limitation so a future loading state has to update this test deliberately.
    onInvoke("get_genres", () => []);
    await mount();
    expect(screen.getByText("No genres found")).toBeInTheDocument();

    cleanup();
    resetGenresCache();
    onInvoke("get_genres", () => new Promise(() => {}));
    render(<SmartPlaylistModal onSave={async () => {}} onClose={() => {}} />);
    await act(async () => {});
    expect(screen.getByText("No genres found")).toBeInTheDocument();
  });

  it("renders at most 60 genres with no overflow affordance", async () => {
    const many: Genre[] = Array.from({ length: 75 }, (_, i) => ({
      canonical_id: `g-${i}`,
      name: `Genre ${i}`,
      album_count: 1,
    }));
    onInvoke("get_genres", () => many);
    await mount();
    expect(availableChips()).toHaveLength(60);
    expect(screen.queryByText(/more/i)).toBeNull();
  });

  it("swaps IN for NOT IN in the built query when exclude mode is chosen", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    fireEvent.click(screen.getByRole("button", { name: "Jazz" }));
    fireEvent.click(screen.getByRole("button", { name: "Exclude" }));
    fireEvent.click(saveBtn());
    await act(async () => {});

    const filters = savedFilters(onSave);
    expect(filters.genreMode).toBe("exclude");
    expect(buildSmartQuery(filters, "srv-a").sql).toContain("NOT IN (SELECT album_id");
  });

  it("marks the active genre mode by class, since the buttons carry no pressed state", async () => {
    await mount();
    const include = screen.getByRole("button", { name: "Include" });
    const exclude = screen.getByRole("button", { name: "Exclude" });
    expect(include.className).toContain("spm-mode-btn--active");
    expect(exclude.className).not.toContain("spm-mode-btn--active");

    fireEvent.click(exclude);
    expect(exclude.className).toContain("spm-mode-btn--active");
    expect(include.className).not.toContain("spm-mode-btn--active");
  });
});

describe("SmartPlaylistModal numeric fields", () => {
  it("clamps a limit above the maximum", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Limit"), "600");
    expect((field("Limit") as HTMLInputElement).value).toBe(String(LIMIT_MAX));
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).limit).toBe(LIMIT_MAX);
  });

  it("clamps a zero limit to the floor of 1 rather than snapping back to the default", async () => {
    // Regression: the handler read `Number(value) || 50`, so "0" took the falsy branch and
    // became 50, which made the `Math.max(1, ...)` beside it dead code for that one input.
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Limit"), "0");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).limit).toBe(1);
  });

  it("clamps a negative limit to the floor of 1", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Limit"), "-5");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).limit).toBe(1);
  });

  it("falls back to the default when the limit field is cleared, since the state cannot hold empty", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Limit"), "");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).limit).toBe(50);
  });

  it("leaves an out-of-range limit from rules_json unclamped, because only the handler clamps", async () => {
    const initial: SmartFilters = { ...DEFAULT_SMART_FILTERS, name: "Huge", limit: 100000 };
    const { onSave } = await mount({ initialFilters: initial, title: "Edit Smart Playlist" });
    fireEvent.click(saveBtn());
    await act(async () => {});
    // buildSmartQuery is the only thing that rescues this, at query time.
    expect(savedFilters(onSave).limit).toBe(100000);
    expect(buildSmartQuery(savedFilters(onSave), "srv-a").sql).toContain(
      `LIMIT ${LIMIT_MAX}`
    );
  });

  it("stores a blank year as null, not zero, and omits it from the query", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Year from"), "1970");
    type(field("Year from"), "");
    fireEvent.click(saveBtn());
    await act(async () => {});

    const filters = savedFilters(onSave);
    expect(filters.yearFrom).toBeNull();
    expect(buildSmartQuery(filters, "srv-a").sql).not.toContain("t.year >=");
  });

  it("accepts a year outside the min/max attributes, which are markup only", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Year from"), "1200");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).yearFrom).toBe(1200);
  });

  it("renders a min play count of zero as an empty field", async () => {
    await mount();
    expect((field("Min play count") as HTMLInputElement).value).toBe("");
  });

  it("clamps a negative min play count to zero", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Min play count"), "-4");
    fireEvent.click(saveBtn());
    await act(async () => {});
    expect(savedFilters(onSave).minPlayCount).toBe(0);
  });

  it("keeps text-filter whitespace intact, since buildSmartQuery trims at use", async () => {
    const { onSave } = await mount();
    type(field("Name"), "Mix");
    type(field("Artist contains"), "  Beatles  ");
    fireEvent.click(saveBtn());
    await act(async () => {});

    const filters = savedFilters(onSave);
    expect(filters.artistContains).toBe("  Beatles  ");
    expect(buildSmartQuery(filters, "srv-a").params).toContain("%Beatles%");
  });
});

describe("SmartPlaylistModal create vs edit mode", () => {
  it("shows the create title and Create button with no initialFilters", async () => {
    await mount();
    expect(screen.getByText("New Smart Playlist")).toBeInTheDocument();
    expect(saveBtn().textContent).toContain("Create");
    expect((field("Limit") as HTMLInputElement).value).toBe("50");
  });

  it("shows Save & Refresh when the title starts with Edit", async () => {
    await mount({ initialFilters: parseSmartFilters(SAVED_RULES)!, title: "Edit Smart Playlist" });
    expect(saveBtn().textContent).toContain("Save & Refresh");
  });

  it("labels the button Create in edit mode when the title does not start with Edit", async () => {
    // The button label sniffs `title`, while the prefilled state comes from `initialFilters`.
    // Two sources for one fact, and they disagree here.
    await mount({ initialFilters: parseSmartFilters(SAVED_RULES)!, title: "Modify rules" });
    expect(saveBtn().textContent).toContain("Create");
  });

  it("ignores initialFilters that change while mounted, since it is only a state initializer", async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    const { rerender } = render(
      <SmartPlaylistModal
        initialFilters={{ ...DEFAULT_SMART_FILTERS, name: "First" }}
        onSave={onSave}
        onClose={onClose}
        title="Edit A"
      />
    );
    await act(async () => {});
    rerender(
      <SmartPlaylistModal
        initialFilters={{ ...DEFAULT_SMART_FILTERS, name: "Second" }}
        onSave={onSave}
        onClose={onClose}
        title="Edit A"
      />
    );
    expect((field("Name") as HTMLInputElement).value).toBe("First");
  });
});

describe("SmartPlaylistModal chrome and dismissal", () => {
  it("renders into document.body rather than the caller's container", async () => {
    const { container } = await mount();
    expect(container.querySelector(".spm-dialog")).toBeNull();
    expect(document.body.querySelector(".spm-dialog")).not.toBeNull();
  });

  it("autofocuses the name input", async () => {
    await mount();
    expect(document.activeElement).toBe(field("Name"));
  });

  it("closes on a click that starts and ends on the overlay", async () => {
    const { onClose } = await mount();
    fireEvent.mouseDown(overlay());
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a click inside the dialog", async () => {
    const { onClose } = await mount();
    fireEvent.mouseDown(dialog());
    fireEvent.click(dialog());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when a drag starts inside the dialog and releases on the overlay", async () => {
    // Regression, same class as known-issues' "Left-click popup self-closes": dismissing on
    // `click` alone means selecting text in an input and releasing outside the dialog fires a
    // click on the overlay (their nearest common ancestor) and discards the whole form.
    const { onClose } = await mount();
    type(field("Name"), "Half-typed name");

    fireEvent.mouseDown(field("Name"));
    fireEvent.mouseUp(overlay());
    fireEvent.click(overlay());

    expect(onClose).not.toHaveBeenCalled();
    expect((field("Name") as HTMLInputElement).value).toBe("Half-typed name");
  });

  it("closes on the header X", async () => {
    const { onClose } = await mount();
    fireEvent.click(closeBtn());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel", async () => {
    const { onClose } = await mount();
    fireEvent.click(cancelBtn());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Escape, and traps no focus", async () => {
    // Pinning an absence, as TrackTableView does for arrow keys. There is no keydown listener,
    // no focus trap and no role="dialog" here; review.md defers all three to an app-wide modal
    // chrome pass. When that lands, this test goes red and has to be rewritten deliberately.
    const { onClose } = await mount();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SmartPlaylistModal waste", () => {
  it("fetches the genre list once across a full editing session", async () => {
    await mount();
    type(field("Name"), "Mix");
    type(document.querySelector(".spm-genre-search") as HTMLInputElement, "r");
    type(document.querySelector(".spm-genre-search") as HTMLInputElement, "ro");
    type(document.querySelector(".spm-genre-search") as HTMLInputElement, "roc");
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    type(field("Limit"), "100");
    await act(async () => {});

    expect(invokeCount("get_genres")).toBe(1);
  });

  it("reuses the cached genre rows on a second mount without refetching", async () => {
    await mount();
    expect(invokeCount("get_genres")).toBe(1);
    cleanup();
    await mount();
    expect(invokeCount("get_genres")).toBe(1);
  });
});
