// @vitest-environment jsdom
//
// Acceptance-level, and the direct answer to the complaint this change exists for: "I search
// something, but how can I then go back to the screen?"
//
// Search used to render *instead of* `<AppRoutes>` while the URL never moved, so every way out
// was either invisible to the router (Escape, two unlabelled X glyphs) or moved the router
// behind it - one Back press lost the search *and* the page the user was on. As a route it
// pushes exactly one entry, so Back is the way out and costs one press. Every door in and out
// is covered here, because the failure mode is a door that quietly stops working.
//
// Same boundary mocks as `App.keyboard.test.tsx`: Tauri, the SQLite handle, the keychain, the
// updater, the remote notice. `AppRoutes` itself is real, as in `App.albumRoute.test.tsx` and
// unlike the other `App.*` acceptance files, because two of the doors under test (the library
// header's Search button, the sidebar row) live inside it. What is stubbed instead is the
// handful of large windowed subtrees those routes hang off - each needs `ResizeObserver` and
// layout metrics jsdom does not have, and none of them is asserted on here.
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../lib/updater", () => ({ checkForUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/notice", () => ({ fetchRemoteNotice: vi.fn().mockResolvedValue(null) }));
vi.mock("../keychain", () => ({
  keychain: {
    get: vi.fn().mockResolvedValue(
      JSON.stringify({ type: "token", username: "u", token: "t", salt: "s" }),
    ),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => testDb) }));
vi.mock("../components/PlayerBar", () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock("../hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.6.0") }));
// `SearchResults`' pairing with `SearchView` is covered against the real component in
// `App.modalInOverlay.test.tsx`. Nothing here asserts on a result row, a grid cell or a filter.
vi.mock("../components/SearchResults", () => ({
  SearchResults: () => <div data-testid="results" />,
}));
vi.mock("../components/AlbumGrid", () => ({ AlbumGrid: () => <div data-testid="album-grid" /> }));
vi.mock("../components/FilterSidebar", () => ({ FilterSidebar: () => <div data-testid="filters" /> }));
vi.mock("../components/ArtistGrid", () => ({ ArtistGrid: () => <div data-testid="artist-grid" /> }));
vi.mock("../components/HomeView", () => ({ HomeView: () => <div data-testid="home-view" /> }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

allowSlowAppMounts();

const DEBOUNCE_MS = 200;

let testDb: FakeDatabase;
let navLog: string[] = [];

async function seedLibrary() {
  testDb = await createMigratedTestDb();
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?)",
    ["srv-a", "https://example.test", "Test", "u"],
  );
  testDb.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, 'srv-a', 'navidrome', ?, ?)`,
    )
    .run("alb-1", "Arrival", "ABBA");
  // `tracks_fts` has no triggers (migrations v5); `sync.ts` writes it explicitly, so a test that
  // wants search hits has to seed it by hand.
  testDb.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, 'srv-a', 'navidrome', ?, ?, ?)`,
    )
    .run("trk-1", "Dancing Queen", "ABBA", "alb-1");
  testDb.raw
    .prepare(`INSERT INTO tracks_fts (id, title, artist, album, genre) VALUES (?, ?, ?, ?, '')`)
    .run("trk-1", "Dancing Queen", "ABBA", "Arrival");
}

/**
 * Reports where the router is, and how it got there. `AppRoutes` is stubbed, so nothing else in
 * the tree can say; and "how" is the whole waste question - typing must `replace`, never push.
 */
function NavProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => { navLog.push(navigationType); }, [location, navigationType]);
  return <div data-testid="url">{location.pathname + location.search}</div>;
}

async function mountApp(entries: string[] = ["/library"], index = entries.length - 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <App />
        <NavProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The shell only renders once `useServers` resolves; before that App renders the Wizard.
  await waitFor(() => expect(sidebarButton("Search")).not.toBeNull());
  navLog = [];
  return view;
}

/** Fire a window keydown the way the browser does: `target` is what has focus. */
function press(key: string, opts: { ctrlKey?: boolean; altKey?: boolean; target?: Element } = {}) {
  const target = opts.target ?? document.activeElement ?? document.body;
  fireEvent.keyDown(target, {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
  });
}

const searchInput = () => document.querySelector(".search-bar-input") as HTMLInputElement | null;
const url = () => screen.getByTestId("url").textContent;
const sidebarButton = (label: string) =>
  document.querySelector(`.sidebar-btn[title="${label}"]`) as HTMLElement | null;

/** Go to /search by shortcut and wait for the route to be the one rendering. */
async function openSearch() {
  await act(async () => { press("f", { ctrlKey: true }); });
  await waitFor(() => expect(searchInput()).not.toBeNull());
}

/** Type into the search box and let the 200ms debounce land in the URL. */
async function type(value: string) {
  fireEvent.change(searchInput()!, { target: { value } });
  await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 2)); });
}

/** The three section reads `useSearch` issues under one `Promise.all`, per completed round. */
const searchReads = () =>
  testDb.queryLog.filter((q) => q.sql.includes("ranked AS MATERIALIZED")).length;

beforeEach(async () => {
  resetTauriMocks();
  navLog = [];
  await seedLibrary();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the /search route", () => {
  it("returns to the page search was opened from in one Back press", async () => {
    // The complaint, verbatim. One press, and it lands on /library rather than on whatever was
    // behind /library - which is what Back cost while search was an overlay the router could
    // not see.
    await mountApp(["/home", "/library"], 1);
    await openSearch();
    await type("abba");
    expect(url()).toBe("/search?q=abba");

    await act(async () => { press("ArrowLeft", { altKey: true }); });

    await waitFor(() => expect(url()).toBe("/library"));
    expect(searchInput()).toBeNull();
  });

  it("returns in one press of the mouse thumb button too", async () => {
    await mountApp(["/home", "/library"], 1);
    await openSearch();
    await type("abba");

    await act(async () => { fireEvent.mouseUp(window, { button: 3 }); });

    await waitFor(() => expect(url()).toBe("/library"));
  });

  it("returns on Escape from the search input", async () => {
    await mountApp(["/home", "/library"], 1);
    await openSearch();
    await type("abba");

    await act(async () => { press("Escape", { target: searchInput()! }); });

    await waitFor(() => expect(url()).toBe("/library"));
  });

  it("returns on the header's own Back button", async () => {
    // The affordance for anyone who does not know Escape or Alt+Left exists - which was the
    // other half of the complaint: the only visible exits were two unlabelled X glyphs.
    await mountApp(["/home", "/library"], 1);
    await openSearch();

    await act(async () => {
      fireEvent.click(document.querySelector(".search-back-btn") as HTMLElement);
    });

    await waitFor(() => expect(url()).toBe("/library"));
  });

  it("lands on /home when search is the first entry there is to leave", async () => {
    // Reachable through the `web-process-terminated -> view.reload()` recovery in lib.rs: the
    // window reloads straight onto whatever URL it was showing. `navigate(-1)` from history
    // index 0 goes nowhere, so the user would be stuck on a page whose exits all did nothing.
    await mountApp(["/search"], 0);
    await waitFor(() => expect(searchInput()).not.toBeNull());

    await act(async () => { press("Escape", { target: searchInput()! }); });

    await waitFor(() => expect(url()).toBe("/home"));
  });

  it("opens from Ctrl+F on an arbitrary route", async () => {
    await mountApp(["/artists"]);
    await openSearch();
    expect(url()).toBe("/search");
    expect(document.activeElement).toBe(searchInput());
  });

  it("opens from the library header's Search button", async () => {
    await mountApp(["/library"]);
    await act(async () => {
      fireEvent.click(document.querySelector(".search-trigger-btn") as HTMLElement);
    });
    await waitFor(() => expect(url()).toBe("/search"));
  });

  it("opens from the sidebar, which then lights Search rather than Library", async () => {
    // The sidebar highlight used to lie outright: Library stayed lit while search covered the
    // whole app, because the highlight reads the URL and the URL never moved.
    await mountApp(["/library"]);
    await act(async () => { fireEvent.click(sidebarButton("Search")!); });

    await waitFor(() => expect(url()).toBe("/search"));
    expect(sidebarButton("Search")!.className).toContain("sidebar-btn--active");
    expect(sidebarButton("Library")!.className).not.toContain("sidebar-btn--active");
  });

  it("re-selects the query on Ctrl+F pressed while already searching", async () => {
    // Rather than pushing a second /search entry, which would cost the user a Back press per
    // press of the shortcut.
    await mountApp(["/library"]);
    await openSearch();
    await type("abba");
    const beforeVisits = navLog.length;
    searchInput()!.setSelectionRange(4, 4);

    await act(async () => { press("f", { ctrlKey: true, target: searchInput()! }); });

    expect(url()).toBe("/search?q=abba");
    expect(navLog.length).toBe(beforeVisits);
    expect(searchInput()!.selectionStart).toBe(0);
    expect(searchInput()!.selectionEnd).toBe(4);
  });
});

describe("the /search route's cost", () => {
  it("charges a five-keystroke query one history entry, one replace and one search round", async () => {
    // Typing must never push: each push is a Back press the user has to spend to get out, and
    // five of them turn one exit into six. And each round is three SQL reads (albums, tracks,
    // artists, under one Promise.all), so an undebounced box would be fifteen.
    await mountApp(["/library"]);
    await openSearch();
    testDb.queryLog.length = 0;

    for (const value of ["a", "ab", "abb", "abba", "abbas"]) {
      fireEvent.change(searchInput()!, { target: { value } });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 2)); });
    await waitFor(() => expect(url()).toBe("/search?q=abbas"));

    expect(navLog.filter((t) => t === "PUSH").length).toBe(1);
    expect(navLog.filter((t) => t === "REPLACE").length).toBe(1);
    expect(searchReads()).toBe(3);
  });

  it("keeps the same input element across a query, so focus is claimed once per visit", async () => {
    // The callback ref focuses and selects on attach. If the input were remounted per keystroke
    // - a changed `key`, a branch swap around it - it would re-select the text mid-typing and
    // the next character would replace the query.
    await mountApp(["/library"]);
    await openSearch();
    const first = searchInput();

    for (const value of ["a", "ab", "abb", "abba", "abbas"]) {
      fireEvent.change(searchInput()!, { target: { value } });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 2)); });

    expect(searchInput()).toBe(first);
    expect(searchInput()!.value).toBe("abbas");
  });

  it("leaves no stray ?q on the page it was navigated away from mid-debounce", async () => {
    // The one bug this route's debounce introduces: a write still pending when the user leaves
    // lands on wherever they went, tacking a query string onto a page that has no search.
    await mountApp(["/home", "/library"], 1);
    await openSearch();
    fireEvent.change(searchInput()!, { target: { value: "abba" } });
    await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS / 2)); });

    await act(async () => { press("ArrowLeft", { altKey: true }); });
    await waitFor(() => expect(url()).toBe("/library"));
    await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 2)); });

    expect(url()).toBe("/library");
  });
});
