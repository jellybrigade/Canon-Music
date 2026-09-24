// @vitest-environment jsdom
//
// Acceptance-level: mounts the real `App` and drives its window keyboard shortcuts the way a
// user does. The handler under test (`useSearchShortcuts`, called from `App.tsx`) cannot be
// reached from `AppShell.navigation.test.tsx`, whose harness reimplements the search state
// locally and installs no keydown listener at all.
//
// Only boundaries are mocked: Tauri `invoke`/`listen`, the SQLite handle, the keychain, the
// updater and the remote-notice fetch. Two stubs are not boundaries and are deliberate:
// `AppRoutes` (every route pulls its own data and none of it is what this file asserts) and
// `PlayerBar` (a large audio-bound subtree). `AppShell`, its search bar, and `CommandPalette`
// with its own input are all real, because the whole question here is which of those two
// inputs owns a keystroke.
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../lib/updater", () => ({ checkForUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("../clients/notice", () => ({ fetchRemoteNotice: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/keychain", () => ({
  keychain: {
    get: vi.fn().mockResolvedValue(
      JSON.stringify({ type: "token", username: "u", token: "t", salt: "s" }),
    ),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => testDb) }));
// The real search UI moved from AppShell's own overlay branch to a route (`/search`) that
// AppRoutes owns, so the stub has to keep rendering the real SearchView on that one path.
vi.mock("./AppRoutes", async () => ({
  AppRoutes: (await import("../test/appRoutesStub")).AppRoutesSearchStub,
}));
vi.mock("../features/playback/components/PlayerBar", () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock("../features/playback/hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { usePlayerStore } from "../features/playback/store/player";

allowSlowAppMounts();

let testDb: FakeDatabase;

async function seedServer() {
  testDb = await createMigratedTestDb();
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?)",
    ["srv-a", "https://example.test", "Test", "u"],
  );
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
  // The shell only renders once `useServers` resolves; before that App renders the Wizard.
  await screen.findByTestId("route-content");
  return view;
}

/** Fire a window keydown the way the browser does: `target` is what has focus. */
function press(key: string, opts: { ctrlKey?: boolean; target?: Element } = {}) {
  const target = opts.target ?? document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ctrlKey: opts.ctrlKey ?? false, bubbles: true });
}

const paletteInput = () => document.querySelector(".cp-input") as HTMLInputElement | null;
const searchInput = () => document.querySelector(".search-bar-input") as HTMLInputElement | null;

beforeAll(() => {
  // The palette scrolls its focused row into view, and jsdom does not implement
  // scrollIntoView at all - without this the arrow-key cases throw instead of asserting.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
});

beforeEach(async () => {
  resetTauriMocks();
  await seedServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App keyboard shortcuts", () => {
  it("opens the command palette on Ctrl+K when nothing has focus", async () => {
    await mountApp();
    expect(paletteInput()).toBeNull();

    await act(async () => { press("k", { ctrlKey: true }); });

    expect(paletteInput()).not.toBeNull();
  });

  it("opens and focuses the search bar on Ctrl+F when nothing has focus", async () => {
    await mountApp();

    await act(async () => { press("f", { ctrlKey: true }); });
    await waitFor(() => expect(searchInput()).not.toBeNull());
    await act(async () => { await Promise.resolve(); });

    expect(document.activeElement).toBe(searchInput());
  });

  it("does not open the search bar on Ctrl+F while the command palette input has focus", async () => {
    // The bug: the window listener has no focus guard, so a shortcut fires while the user is
    // typing and `preventDefault` swallows the keystroke rather than merely duplicating it.
    await mountApp();
    await act(async () => { press("k", { ctrlKey: true }); });
    const input = paletteInput();
    expect(input).not.toBeNull();
    input!.focus();

    await act(async () => { press("f", { ctrlKey: true, target: input! }); });

    expect(searchInput()).toBeNull();
  });

  it("still toggles the command palette closed on Ctrl+K from its own input", async () => {
    // The guard must not cost the palette its toggle: the palette's input is the only thing
    // that can have focus while the palette is open.
    await mountApp();
    await act(async () => { press("k", { ctrlKey: true }); });
    const input = paletteInput();
    expect(input).not.toBeNull();
    input!.focus();

    await act(async () => { press("k", { ctrlKey: true, target: input! }); });

    expect(paletteInput()).toBeNull();
  });

  it("still leaves search on Escape while the search input has focus", async () => {
    // The other half of the guard: Ctrl+F deliberately focuses the search input, and Escape
    // to leave is pressed from inside that very input. A blanket "bail on any input" guard
    // would strand the user on /search. Escape now navigates back rather than blanking the
    // field in place, so the input is gone, not empty.
    await mountApp();
    await act(async () => { press("f", { ctrlKey: true }); });
    await waitFor(() => expect(searchInput()).not.toBeNull());
    const input = searchInput()!;
    fireEvent.change(input, { target: { value: "abba" } });
    expect(input.value).toBe("abba");

    await act(async () => { press("Escape", { target: input }); });

    await waitFor(() => expect(searchInput()).toBeNull());
    expect(screen.getByTestId("route-content")).toBeTruthy();
  });

  it("does not leave search on Escape pressed from an unrelated text input", async () => {
    // Escape inside another field (a rename box, a modal form) belongs to that field.
    await mountApp();
    await act(async () => { press("f", { ctrlKey: true }); });
    await waitFor(() => expect(searchInput()).not.toBeNull());
    fireEvent.change(searchInput()!, { target: { value: "abba" } });

    const stray = document.createElement("input");
    document.body.appendChild(stray);
    stray.focus();
    await act(async () => { press("Escape", { target: stray }); });
    stray.remove();

    expect(searchInput()?.value).toBe("abba");
  });

  it("changes the volume on ArrowDown with nothing open", async () => {
    // Positive control for the case below: without it, an ArrowDown that silently stopped
    // reaching the player for any reason would make that assertion pass for free.
    await mountApp();
    const before = usePlayerStore.getState().volume;

    await act(async () => { press("ArrowDown", { target: document.body }); });

    expect(usePlayerStore.getState().volume).toBeCloseTo(before - 0.05);
  });

  it("does not change the volume on ArrowDown while the command palette is open", async () => {
    // Result rows preventDefault their own mousedown but their wrappers do not, so clicking
    // blank space inside the results blurs the palette input to <body>. Arrowing the list
    // then moved the volume as well: being scoped to an open overlay is not the same as
    // owning the key.
    await mountApp();
    await act(async () => { press("k", { ctrlKey: true }); });
    expect(paletteInput()).not.toBeNull();
    paletteInput()!.blur();
    const before = usePlayerStore.getState().volume;

    await act(async () => { press("ArrowDown", { target: document.body }); });

    expect(usePlayerStore.getState().volume).toBe(before);
  });

  it("keeps its window keydown listener count across a navigation and N keystrokes", async () => {
    // Two listeners, armed once each: `useSearchShortcuts` and `useAppNavigation`'s Alt+Arrow.
    // `useSearchShortcuts`' effect used to list `[searchRaw, searchOpen, clearSearch]`, so
    // every keystroke in the search box tore it down and re-registered it. `useAppNavigation`
    // listed `navigate`, which react-router replaces on every location change - harmless while
    // search was an overlay, one extra arm per navigation now that Ctrl+F is one.
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);
    const addSpy = vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "keydown") added.push(type);
      realAdd(type, listener, opts);
    }) as typeof window.addEventListener);
    const removeSpy = vi.spyOn(window, "removeEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | EventListenerOptions,
    ) => {
      if (type === "keydown") removed.push(type);
      realRemove(type, listener, opts);
    }) as typeof window.removeEventListener);

    const { unmount } = await mountApp();
    const afterMount = added.length;

    await act(async () => { press("f", { ctrlKey: true }); });
    await waitFor(() => expect(searchInput()).not.toBeNull());
    fireEvent.change(searchInput()!, { target: { value: "a" } });
    fireEvent.change(searchInput()!, { target: { value: "ab" } });
    fireEvent.change(searchInput()!, { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });

    expect(added.length).toBe(afterMount);

    unmount();
    expect(removed.length).toBe(added.length);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
