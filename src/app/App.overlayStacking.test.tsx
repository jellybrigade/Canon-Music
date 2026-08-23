// @vitest-environment jsdom
//
// Acceptance-level: mounts the real `App` and stacks the command palette over the search
// overlay, the way a user reaches it. Both are `useState` in `App.tsx`, neither is URL-backed,
// and they are drawn by two different mechanisms - the search overlay renders *instead of*
// `<AppRoutes>` (`AppShell.renderContent`), while `CommandPalette` is an always-mounted sibling
// painting over whichever of the two is underneath. So "which overlay owns Escape" is a
// composition question that no test over either unit can see.
//
// Reaching the stack takes a blur: `useSearchShortcuts`' Ctrl+K branch bails while a text field
// has focus unless the palette is already open, and Ctrl+F focuses the search input. So the
// order is always Ctrl+F, blur, Ctrl+K. That awkwardness is itself pinned below, because if a
// guard change ever makes Ctrl+K unreachable from the overlay entirely, every test here would
// otherwise go quietly vacuous.
//
// Same boundary mocks as `App.keyboard.test.tsx`, and for the same reasons: `AppRoutes` and
// `PlayerBar` are stubs (not boundaries, just large subtrees this file never asserts on), while
// `AppShell`, its search bar and `CommandPalette` are all real, because they are the pairing
// under test.
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
// Real `FeedbackModal` - it is the second overlay that stacks over search, and its Escape
// listener is on `document` rather than `window`, which is the whole point of covering it.
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.6.0") }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

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
  await screen.findByTestId("route-content");
  return view;
}

/** Fire a window keydown the way the browser does: `target` is what has focus. */
function press(key: string, opts: { ctrlKey?: boolean; target?: Element } = {}) {
  const target = opts.target ?? document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ctrlKey: opts.ctrlKey ?? false, bubbles: true });
}

const paletteInput = () => document.querySelector(".cp-input") as HTMLInputElement | null;
const paletteBackdrop = () => document.querySelector(".cp-backdrop") as HTMLElement | null;
const paletteModal = () => document.querySelector(".cp-modal") as HTMLElement | null;
const searchInput = () => document.querySelector(".search-bar-input") as HTMLInputElement | null;
/** The search overlay renders instead of the router, so the route stub is its absence. */
const routeContent = () => screen.queryByTestId("route-content");

/**
 * Every dismissal here is a React state update made from a listener the app registered on
 * `window` or `document`, not from a handler React dispatched, so the commit that removes the
 * overlay lands after the press rather than inside it. Asserting the removal directly races
 * that commit, and the race is invisible in the assertion - it reads as a wrong dismissal on
 * whichever case the machine happened to slow down. The `searchInput()` check beside each of
 * these is the positive control that keeps the absent assertion honest.
 */
const expectGone = (get: () => Element | null) => waitFor(() => expect(get()).toBeNull());

/**
 * Open the search overlay with text in it, then stack the palette on top.
 * Leaves focus in the palette's input, which is where the app itself puts it.
 */
async function stackPaletteOverSearch(query = "abba") {
  await mountApp();
  await act(async () => { press("f", { ctrlKey: true }); });
  await waitFor(() => expect(searchInput()).not.toBeNull());
  fireEvent.change(searchInput()!, { target: { value: query } });
  // Ctrl+K is guarded against firing from a text field, so the user has to leave the search
  // input first - clicking any blank part of the overlay does it.
  searchInput()!.blur();
  await act(async () => { press("k", { ctrlKey: true }); });
  await waitFor(() => expect(paletteInput()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(paletteInput()));
}

beforeEach(async () => {
  resetTauriMocks();
  await seedServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("command palette stacked over the search overlay", () => {
  it("renders both overlays at once, with the route still swapped out", async () => {
    // The setup step for everything below, asserted on its own so a guard change that makes
    // the palette unreachable from the overlay fails here rather than silently emptying the
    // rest of the file.
    await stackPaletteOverSearch();

    expect(searchInput()).not.toBeNull();
    expect(paletteInput()).not.toBeNull();
    expect(routeContent()).toBeNull();
  });

  it("closes only the palette on Escape pressed from the palette's own input", async () => {
    await stackPaletteOverSearch();

    await act(async () => { press("Escape", { target: paletteInput()! }); });

    await expectGone(paletteInput);
    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
  });

  it("closes only the palette on Escape pressed with nothing focused", async () => {
    // Reachable: result rows preventDefault their mousedown, but the surrounding `.cp-results`
    // and `.cp-section` wrappers do not, so clicking blank space inside the palette blurs to
    // `body`. `useSearchShortcuts`' Escape guard short-circuits on `typing`, so with no text
    // field focused it ran `clearSearch()` and the palette's own listener then closed the
    // palette - one keypress collapsing the whole stack.
    await stackPaletteOverSearch();
    paletteInput()!.blur();

    await act(async () => { press("Escape", { target: document.body }); });

    await expectGone(paletteInput);
    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
  });

  it("closes only the palette on Escape pressed from the search input underneath it", async () => {
    // The sharpest case, and the one the existing focus guard actively causes: Escape exempts
    // the search input by ref identity (so Escape can dismiss search from the field it lives
    // in), and that exemption is exactly what lets the keypress through while the palette is
    // painted over the top.
    //
    // Reachable: with the palette open and focus on `body`, Ctrl+F passes its own guard and
    // focuses the search input *underneath* the palette.
    await stackPaletteOverSearch();
    paletteInput()!.blur();
    await act(async () => { press("f", { ctrlKey: true, target: document.body }); });
    await waitFor(() => expect(document.activeElement).toBe(searchInput()));
    expect(paletteInput()).not.toBeNull();

    await act(async () => { press("Escape", { target: searchInput()! }); });

    await expectGone(paletteInput);
    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
  });

  it("clears the search overlay on the second Escape, once the palette is gone", async () => {
    // "Topmost only" means nothing unless the next press reaches the next layer down.
    await stackPaletteOverSearch();

    await act(async () => { press("Escape", { target: paletteInput()! }); });
    await expectGone(paletteInput);
    expect(searchInput()).not.toBeNull();

    await act(async () => { press("Escape", { target: searchInput()! }); });

    await waitFor(() => expect(routeContent()).not.toBeNull());
    expect(searchInput()).toBeNull();
    expect(paletteInput()).toBeNull();
  });

  it("still closes the palette on Escape when no search overlay is under it", async () => {
    // Guards against a fix that makes the palette's dismissal conditional on the layer below.
    await mountApp();
    await act(async () => { press("k", { ctrlKey: true }); });
    await waitFor(() => expect(paletteInput()).not.toBeNull());

    await act(async () => { press("Escape", { target: paletteInput()! }); });

    await expectGone(paletteInput);
    expect(routeContent()).not.toBeNull();
  });

  it("does not clear the search overlay when Escape closes the palette from a stray field", async () => {
    // The palette's own listener has no focus guard at all, so Escape from an unrelated input
    // closes it. Whatever that is worth, it must not also take the search overlay down.
    await stackPaletteOverSearch();
    const stray = document.createElement("input");
    document.body.appendChild(stray);
    stray.focus();

    await act(async () => { press("Escape", { target: stray }); });
    stray.remove();

    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
  });

  it("closes only the palette when its backdrop is clicked over the search overlay", async () => {
    await stackPaletteOverSearch();

    await act(async () => { fireEvent.mouseDown(paletteBackdrop()!); });

    await expectGone(paletteInput);
    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
    expect(routeContent()).toBeNull();
  });

  it("keeps the palette open when a drag starts inside it and releases on the backdrop", async () => {
    // Regression for known-issues' "Dismissing a backdrop on `click` dismisses on a gesture
    // that only ended there". The palette dismisses on `mousedown` + target identity, so
    // selecting text in its input and releasing outside must not close it - and must certainly
    // not collapse to the search overlay behind it.
    await stackPaletteOverSearch();

    await act(async () => {
      fireEvent.mouseDown(paletteModal()!);
      fireEvent.mouseUp(paletteBackdrop()!);
      fireEvent.click(paletteBackdrop()!);
    });

    expect(paletteInput()).not.toBeNull();
    expect(searchInput()).not.toBeNull();
  });

  it("closes only the feedback modal on Escape while the search overlay is open", async () => {
    // The palette is not the only thing that stacks over search, and the feedback modal is the
    // *harder* instance: its Escape listener is on `document`, so it fires before the window
    // listener rather than after it. A fix that only named the command palette would leave
    // this one collapsing both layers, which is why the guard asks "is anything above me"
    // rather than "is the palette open".
    await mountApp();
    await act(async () => { press("f", { ctrlKey: true }); });
    await waitFor(() => expect(searchInput()).not.toBeNull());
    fireEvent.change(searchInput()!, { target: { value: "abba" } });
    searchInput()!.blur();

    const feedbackBtn = document.querySelector(".sidebar-feedback-btn") as HTMLElement;
    expect(feedbackBtn).not.toBeNull();
    await act(async () => { fireEvent.click(feedbackBtn); });
    await waitFor(() => expect(document.querySelector(".feedback-modal")).not.toBeNull());

    await act(async () => { press("Escape", { target: document.body }); });

    await expectGone(() => document.querySelector(".feedback-modal"));
    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
  });

  it("leaves the search overlay standing when Ctrl+K toggles the palette shut", async () => {
    // The toggle half of the Ctrl+K guard, asserted for what it must *not* touch.
    await stackPaletteOverSearch();

    await act(async () => { press("k", { ctrlKey: true, target: paletteInput()! }); });

    await expectGone(paletteInput);
    expect(searchInput()).not.toBeNull();
    expect(searchInput()!.value).toBe("abba");
    expect(routeContent()).toBeNull();
  });
});
