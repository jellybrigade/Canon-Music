// @vitest-environment jsdom
//
// Acceptance-level: mounts the real `App` and navigates *from outside the command palette*
// while the palette is open.
//
// The palette's open state (`commandPaletteOpen`, `App.tsx`) is not URL-backed and the palette
// paints over whatever the router renders, so it is the same "second invisible router" shape
// `known-issues.md` records under "State deciding which subtree renders, but absent from the
// URL, must be dismissed by navigation itself" - except the search overlay got a mechanism
// (`useDismissOnNavigate`) and the palette never did. Its only dismissals were the five
// hand-written `setCommandPaletteOpen(false)` calls in `AppShell`, one per handler the palette
// itself owns, which is exactly the hand-kept list that entry warns about.
//
// Alt+Arrow and the mouse thumb buttons are `window`-level (`useAppNavigation`), so they reach
// the app straight through the palette's full-viewport backdrop. That is what makes this a live
// user-facing bug rather than a theoretical one: every other navigation source is behind the
// backdrop and unclickable while the palette is up. jsdom has no hit testing, so it would let
// this file click the sidebar too - those rows are deliberately not written, because a real user
// cannot reach them.
//
// Same boundary mocks as `App.overlayStacking.test.tsx`, for the same reasons: `AppRoutes` and
// `PlayerBar` are stubs (large subtrees this file never asserts on), while `AppShell`, its
// search bar and `CommandPalette` are real, because they are the pairing under test.
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "../App";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

let testDb: FakeDatabase;

async function seedServer() {
  testDb = await createMigratedTestDb();
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?)",
    ["srv-a", "https://example.test", "Test", "u"],
  );
}

/** `AppRoutes` is stubbed, so nothing else in the tree reports where the router actually is. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

async function mountApp(entries: string[] = ["/library"], index = entries.length - 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByTestId("route-content");
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

const paletteInput = () => document.querySelector(".cp-input") as HTMLInputElement | null;
const searchInput = () => document.querySelector(".search-bar-input") as HTMLInputElement | null;
const pathname = () => screen.getByTestId("pathname").textContent;

const expectPaletteOpen = () => expect(paletteInput()).not.toBeNull();
const expectPaletteClosed = () => expect(paletteInput()).toBeNull();

/** Ctrl+K from `body`. `useSearchShortcuts` bails while a text field has focus. */
async function openPalette() {
  await act(async () => { press("k", { ctrlKey: true }); });
  await waitFor(() => expect(paletteInput()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(paletteInput()));
}

/**
 * Every navigation source that stays reachable while the palette's backdrop covers the
 * viewport. All four are `window` listeners in `useAppNavigation`.
 */
const windowNavSources: Array<{
  name: string;
  fire: () => void;
  /** Which of the two history entries the app lands on. */
  lands: string;
  /** Index to start at so the navigation is not clamped to a no-op. */
  index: number;
}> = [
  { name: "Alt+ArrowLeft", fire: () => fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true }), lands: "/library", index: 1 },
  { name: "Alt+ArrowRight", fire: () => fireEvent.keyDown(window, { key: "ArrowRight", altKey: true }), lands: "/artists", index: 0 },
  { name: "mouse thumb button 3 (back)", fire: () => fireEvent.mouseUp(window, { button: 3 }), lands: "/library", index: 1 },
  { name: "mouse thumb button 4 (forward)", fire: () => fireEvent.mouseUp(window, { button: 4 }), lands: "/artists", index: 0 },
];

beforeEach(async () => {
  resetTauriMocks();
  await seedServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("command palette dismissed by navigation it did not originate", () => {
  it("opens over the route, which is the setup every case below depends on", async () => {
    // Asserted on its own so a guard change that makes Ctrl+K unreachable fails here rather
    // than quietly emptying the rest of the file.
    await mountApp(["/library", "/artists"], 1);
    await openPalette();
    expectPaletteOpen();
    expect(screen.getByTestId("route-content")).not.toBeNull();
  });

  for (const source of windowNavSources) {
    it(`${source.name} closes the palette it left painted over the new route`, async () => {
      await mountApp(["/library", "/artists"], source.index);
      await openPalette();
      await act(async () => { source.fire(); });
      await waitFor(() => expect(pathname()).toBe(source.lands));
      expectPaletteClosed();
    });
  }

  it("navigating with both overlays up dismisses the palette and the search overlay together", async () => {
    // The search overlay renders *instead of* the router and the palette paints *over* it, so
    // a single navigation has to take both down or the user still sees no route.
    await mountApp(["/library", "/artists"], 1);
    await act(async () => { press("f", { ctrlKey: true }); });
    await waitFor(() => expect(searchInput()).not.toBeNull());
    fireEvent.change(searchInput()!, { target: { value: "abba" } });
    searchInput()!.blur();
    await openPalette();

    await act(async () => { fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true }); });

    await waitFor(() => expect(pathname()).toBe("/library"));
    expectPaletteClosed();
    expect(searchInput()).toBeNull();
    expect(screen.getByTestId("route-content")).not.toBeNull();
  });

  it("leaves the palette open when the key does not navigate", async () => {
    // Plain ArrowLeft is the palette's own list navigation; `useAppNavigation` bails without
    // Alt. Nothing moved, so nothing should be dismissed.
    await mountApp(["/library", "/artists"], 1);
    await openPalette();
    await act(async () => { fireEvent.keyDown(window, { key: "ArrowLeft" }); });
    expect(pathname()).toBe("/artists");
    expectPaletteOpen();
  });

  it("leaves the palette open when Alt+ArrowLeft is clamped at the first history entry", async () => {
    // react-router's memory history clamps `go(-1)` at index 0 and still notifies with the
    // *same* location, so no navigation occurred and the palette is still the thing the user
    // is looking at. Dismissing here would close the palette on a keystroke that did nothing.
    await mountApp(["/library"], 0);
    await openPalette();
    await act(async () => { fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true }); });
    expect(pathname()).toBe("/library");
    expectPaletteOpen();
  });

  it("still closes the palette from its own handlers", async () => {
    // The five hand-written `setCommandPaletteOpen(false)` calls in `AppShell` are what the new
    // mechanism is meant to make unnecessary at the *navigation* sources; the palette's own
    // dismissal must keep working regardless of whether the route actually changes.
    await mountApp(["/library"], 0);
    await openPalette();
    await act(async () => { press("Escape", { target: paletteInput()! }); });
    await waitFor(() => expectPaletteClosed());
  });
});
