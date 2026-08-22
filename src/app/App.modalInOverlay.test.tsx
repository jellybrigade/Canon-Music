// @vitest-environment jsdom
//
// Acceptance-level: a portal modal opened from *inside* the search overlay.
//
// The search overlay renders instead of `<AppRoutes>` (`AppShell.renderContent`) and is not
// URL-backed, so everything it contains dies with it. `SearchResults` opens
// `AlbumIdentifyDialog` from its album context menu, and that dialog is mounted inside the
// overlay's subtree - but it registers no Escape handler of its own, so Escape reaches
// `useSearchShortcuts`' app-lifetime window listener, which knows only about the two overlays
// `App.tsx` names in `overlayAbove` (the command palette and the feedback modal). A dialog
// three levels down is not in that list, so one press clears the search and takes the
// half-filled dialog with it.
//
// This is the same class as known-issues' "An overlay's own Escape handler answers 'am I open',
// never 'am I on top'", but the previous fix enumerated the two stacking overlays by hand in
// `App.tsx`. Enumeration does not reach state that lives in `SearchResults`, which is why the
// registry exists: any modal using the shared modal chrome registers itself, and the bottom
// layer reads a count rather than a hand-written list.
//
// No unit test can see this. `useSearchShortcuts` is correct in isolation, `SearchResults` is
// correct in isolation, `IdentifyDialog` is correct in isolation. The defect is the pairing.
//
// Boundary mocks mirror `App.overlayStacking.test.tsx`. `AppRoutes` and `PlayerBar` are stubs
// (large subtrees this file never asserts on); `AppShell`, `SearchResults` and `IdentifyDialog`
// are all real, because they are the pairing under test. MusicBrainz is a network boundary and
// is stubbed so the dialog mounts without a live lookup.
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
vi.mock("./AppRoutes", () => ({
  AppRoutes: () => <div data-testid="route-content" />,
}));
vi.mock("../components/PlayerBar", () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock("../hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.6.0") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/musicbrainz", () => ({
  searchReleaseGroups: vi.fn().mockResolvedValue([]),
  searchArtists: vi.fn().mockResolvedValue([]),
}));

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

allowSlowAppMounts();

let testDb: FakeDatabase;

/**
 * One server plus one album/track pair that the FTS search will actually return.
 * `tracks_fts` is written by `sync.ts` in production, so a test that wants search hits has to
 * write it directly - the same thing `sync.test.ts` does.
 */
async function seedLibrary() {
  testDb = await createMigratedTestDb();
  testDb.raw.exec(`
    INSERT INTO servers (id, type, url, display_name, username)
      VALUES ('srv-a', 'navidrome', 'https://example.test', 'Test', 'u');
    INSERT INTO albums (id, server_id, server_type, name, artist)
      VALUES ('srv-a:al-1', 'srv-a', 'navidrome', 'Arrival', 'Abba');
    INSERT INTO tracks (id, server_id, server_type, title, album_id, artist)
      VALUES ('srv-a:tr-1', 'srv-a', 'navidrome', 'Dancing Queen', 'srv-a:al-1', 'Abba');
    INSERT INTO tracks_fts (id, title, artist, album, genre)
      VALUES ('srv-a:tr-1', 'Dancing Queen', 'Abba', 'Arrival', 'Pop');
  `);
}

async function mountApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByTestId("route-content");
  return view;
}

/** Fire a window keydown the way the browser does: `target` is what has focus. */
function press(key: string, opts: { ctrlKey?: boolean; target?: Element } = {}) {
  const target = opts.target ?? document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ctrlKey: opts.ctrlKey ?? false, bubbles: true });
}

const searchInput = () => document.querySelector(".search-bar-input") as HTMLInputElement | null;
const identifyDialog = () => document.querySelector(".identify-dialog") as HTMLElement | null;
/** The search overlay renders instead of the router, so the route stub is its absence. */
const routeContent = () => screen.queryByTestId("route-content");
const searchOverlay = () => document.querySelector(".search-results") as HTMLElement | null;

/** Open the search overlay with a query that hits, and wait for the album card to render. */
async function openSearchWithResults(query = "abba") {
  await mountApp();
  await act(async () => { press("f", { ctrlKey: true }); });
  await waitFor(() => expect(searchInput()).not.toBeNull());
  fireEvent.change(searchInput()!, { target: { value: query } });
  // `handleSearchChange` debounces 200ms before `searchQuery` moves, and the FTS round trip
  // through the real migrated DB lands after that, so the default 1s `waitFor` is too tight.
  // The wait has to be inside `act` rather than left to `waitFor`: the FTS round trip resolves
  // off React's watch, and only an act-scoped flush commits the result.
  await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
  await waitFor(() => expect(screen.queryByText("Arrival")).not.toBeNull(), { timeout: 5000 });
}

/** Right-click the album card and pick "Identify on MusicBrainz…" from its context menu. */
async function openIdentifyDialogFromSearch() {
  await openSearchWithResults();
  const card = screen.getByText("Arrival").closest("[class*='album']") as HTMLElement;
  fireEvent.contextMenu(card, { clientX: 10, clientY: 10 });
  const item = await screen.findByText("Identify on MusicBrainz…");
  await act(async () => { fireEvent.click(item); });
  await waitFor(() => expect(identifyDialog()).not.toBeNull());
}

beforeAll(() => {
  // `SearchResults` windows each result section with `useVirtualizer` and measures its own
  // column count from `el.clientWidth` through a raw `ResizeObserver`. jsdom implements
  // neither, so without these the album card never renders and every case below would fail
  // in the harness rather than at its assertion. Same stubs, same reasons, as
  // `AlbumGrid.test.tsx`.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => {} });
});

beforeEach(async () => {
  resetTauriMocks();
  await seedLibrary();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The real migrated DB plus the 200ms search debounce puts every case here over
// vitest's 5s default, so the whole suite gets a wider timeout.
describe("a modal opened inside the search overlay", { timeout: 20000 }, () => {
  it("closes only itself on Escape, leaving the search overlay and its query standing", async () => {
    await openIdentifyDialogFromSearch();
    // Focus is on `body`: `ContextMenu` unmounted the item that was clicked, so nothing in the
    // dialog holds focus (neither `IdentifyDialog` variant autofocuses anything). This is the
    // reachable hole - `useSearchShortcuts`' `typing` guard does not fire, and the dialog is
    // absent from `overlayAbove`.
    await act(async () => { press("Escape", { target: document.body }); });

    expect(identifyDialog()).toBeNull();
    expect(searchOverlay()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
    expect(routeContent()).toBeNull();
  });

  it("closes only itself on Escape pressed from inside one of its own text fields", async () => {
    await openIdentifyDialogFromSearch();
    const field = identifyDialog()!.querySelector("input") as HTMLInputElement;
    field.focus();
    await act(async () => { press("Escape", { target: field }); });

    // These are form fields with no Escape semantics of their own, unlike the rename inputs in
    // `PlaylistDetail`/`TagTreeTab` which own Escape to revert. The dialog closes, and the
    // overlay underneath it does not.
    expect(identifyDialog()).toBeNull();
    expect(searchOverlay()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
  });

  it("hands Escape back to the search overlay once the modal is gone", async () => {
    await openIdentifyDialogFromSearch();
    await act(async () => { press("Escape", { target: document.body }); });
    expect(identifyDialog()).toBeNull();

    await act(async () => { press("Escape", { target: document.body }); });

    // The registry has to be empty again, or the search overlay is permanently undismissable
    // after any modal has ever been opened over it.
    expect(searchOverlay()).toBeNull();
    expect(routeContent()).not.toBeNull();
  });

  it("still dismisses the search overlay on Escape when no modal is open", async () => {
    // Positive control against a fix that over-broadens `overlayAbove` into always-true.
    await openSearchWithResults();
    await act(async () => { press("Escape", { target: document.body }); });

    expect(searchOverlay()).toBeNull();
    expect(routeContent()).not.toBeNull();
  });
});
