// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useState, useCallback } from "react";
import { AppShell } from "./AppShell";
import type { AppViewProps } from "./AppRoutes";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useDismissOnNavigate } from "../hooks/useDismissOnNavigate";

/**
 * Guards known-issues.md's "State deciding which subtree renders, but absent
 * from the URL, must be dismissed by navigation itself". The search overlay
 * (AppShell.renderContent) is the one piece of local state that renders
 * instead of AppRoutes. Every source that can navigate must dismiss it -
 * table-driven so a new source added later fails until it is wired.
 *
 * Mounts AppShell wired to the *real* useAppNavigation + useDismissOnNavigate,
 * the same composition App.tsx uses, so this catches wiring bugs a leaf-level
 * unit test of either hook alone cannot.
 */

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);

// Every route in the real AppRoutes is `lazy`, under the same already-mounted Suspense
// boundary that wraps the search overlay. `suspendControl` lets one test hold the
// destination route unresolved so the dismissal can be observed while it is still loading.
const suspendControl = vi.hoisted(() => ({
  pathname: null as string | null,
  pending: null as Promise<void> | null,
  release: null as (() => void) | null,
}));

vi.mock("./AppRoutes", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppRoutes: (props: any) => {
    if (suspendControl.pathname !== null && props.pathnameForTest === suspendControl.pathname) {
      suspendControl.pending ??= new Promise<void>((resolve) => {
        suspendControl.release = () => {
          suspendControl.pathname = null;
          suspendControl.pending = null;
          resolve();
        };
      });
      throw suspendControl.pending;
    }
    return <div data-testid="route-content">{props.pathnameForTest}</div>;
  },
}));

vi.mock("../components/PlayerBar", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PlayerBar: (props: any) => (
    <div data-testid="player-bar-stub">
      <button data-testid="pb-now-playing" onClick={props.onNowPlaying}>now</button>
      <button data-testid="pb-select-artist" onClick={() => props.onSelectArtist({ name: "Artist Y" })}>artist</button>
      <button data-testid="pb-select-album-by-id" onClick={() => props.onSelectAlbumById("srv:alb2")}>albumbyid</button>
    </div>
  ),
}));

vi.mock("../components/CommandPalette", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CommandPalette: (props: any) => (
    <div data-testid="command-palette-stub">
      <button data-testid="cp-navigate" onClick={() => props.onNavigate("home")}>nav-home</button>
      <button data-testid="cp-navigate-library" onClick={() => props.onNavigate("library")}>nav-library</button>
      <button data-testid="cp-select-album" onClick={() => props.onSelectAlbum({ id: "srv:alb1", title: "A" })}>album</button>
      <button data-testid="cp-select-artist" onClick={() => props.onSelectArtist("Artist X", 3)}>artist</button>
    </div>
  ),
}));

vi.mock("../components/SearchResults", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SearchResults: (props: any) => (
    <div data-testid="search-results-stub">
      <button data-testid="sr-select-album" onClick={() => props.onSelectAlbum({ id: "srv:alb3", title: "C" })}>album</button>
      <button data-testid="sr-select-artist" onClick={() => props.onSelectArtist({ name: "Artist Z" })}>artist</button>
    </div>
  ),
}));

vi.mock("../hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));

afterEach(() => {
  cleanup();
  suspendControl.pathname = null;
  suspendControl.pending = null;
  suspendControl.release = null;
});

// AppShell's Suspense boundary wraps CommandPalette/SearchResults (both lazy),
// so the very first render of the whole suite paints the fallback (null) until
// their dynamic import resolves. Warm the lazy cache once so every real test
// below can assert synchronously like the rest of the suite does.
beforeAll(async () => {
  render(
    <MemoryRouter initialEntries={["/library"]}>
      <Inner startSearchOpen={false} />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId("route-content")).toBeInTheDocument());
  cleanup();
  // The overlay branch (searchOpen: true) lazy-loads SearchResults, a separate
  // lazy() object from CommandPalette/AppRoutes above - warm it too.
  render(
    <MemoryRouter initialEntries={["/library"]}>
      <Inner startSearchOpen={true} />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument());
  cleanup();
});

function makeAlbumRow(id: string) {
  return { id, server_id: "srv", title: id } as unknown as Parameters<ReturnType<typeof useAppNavigation>["openAlbum"]>[0];
}

async function mockLookupAlbum(id: string) {
  return makeAlbumRow(id);
}

function Inner({ startSearchOpen }: { startSearchOpen?: boolean }) {
  const [searchOpen, setSearchOpen] = useState(Boolean(startSearchOpen));
  const [searchQuery, setSearchQuery] = useState(startSearchOpen ? "test" : "");
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchOpen(false);
  }, []);
  const { view, pathname, navigateTo, openAlbum, openArtist } = useAppNavigation(clearSearch);
  useDismissOnNavigate(pathname, clearSearch);
  const rawNavigate = useNavigate();

  async function openAlbumById(albumId: string) {
    const row = await mockLookupAlbum(albumId);
    openAlbum(row);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    server: undefined,
    serverWithCred: { server: {}, credential: "x" },
    playlists: [],
    searchResults: { albums: [], tracks: [], artists: [] },
    searchError: false,
    searchOpen,
    searchQuery,
    searchRaw: searchQuery,
    searchInputRef: { current: null },
    handleSearchChange: (v: string) => setSearchQuery(v),
    clearSearch,
    view,
    navItems: [
      { id: "library", label: "Library", icon: null },
      { id: "home", label: "Home", icon: null },
    ],
    navigateTo,
    openAlbum,
    openArtist,
    openAlbumById,
    handlePlayTrack: async () => {},
    handleStartRadioFromAlbum: async () => {},
    handleStartRadioFromArtist: async () => {},
    addAlbumToPlaylist: async () => {},
    setCanonicalIdFilters: () => {},
    queueClass: "",
    currentTrack: null,
    metaBarVisible: false,
    sidebarExpanded: false,
    setSidebarExpanded: () => {},
    sidebarLiveWidth: null,
    sidebarWidth: 180,
    handleSidebarResizeMouseDown: () => {},
    commandPaletteOpen: true,
    setCommandPaletteOpen: () => {},
    feedbackOpen: false,
    setFeedbackOpen: () => {},
    crashReport: null,
    setCrashReport: () => {},
    pendingUpdate: null,
    setPendingUpdate: () => {},
    remoteNotice: null,
    setRemoteNotice: () => {},
    setLastSeenNoticeId: async () => {},
    pathnameForTest: pathname,
  };

  return (
    <>
      {/* A route-owned navigation, the one kind that never passes through
          useAppNavigation. AppRoutes does this after deleting a playlist. */}
      <button data-testid="raw-navigate" onClick={() => rawNavigate("/playlists")}>raw</button>
      <AppShell {...(props as AppViewProps)} />
    </>
  );
}

function renderHarness(opts: { entries: string[]; index?: number; startSearchOpen?: boolean }) {
  return render(
    <MemoryRouter initialEntries={opts.entries} initialIndex={opts.index}>
      <Inner startSearchOpen={opts.startSearchOpen ?? true} />
    </MemoryRouter>
  );
}

function expectOverlayOpen() {
  expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
  expect(screen.queryByTestId("route-content")).not.toBeInTheDocument();
}

function expectOverlayDismissed() {
  expect(screen.queryByRole("heading", { name: "Search" })).not.toBeInTheDocument();
  expect(screen.getByTestId("route-content")).toBeInTheDocument();
}

describe("AppShell: search overlay dismissed by every navigation source", () => {
  it("starts with the overlay covering the route", () => {
    renderHarness({ entries: ["/library"] });
    expectOverlayOpen();
  });

  it("sidebar nav button click dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/home");
  });

  it("command palette onNavigate dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-navigate"));
    expectOverlayDismissed();
  });

  it("command palette onSelectAlbum dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-select-album"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/album/srv%3Aalb1");
  });

  it("command palette onSelectArtist dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-select-artist"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artist/Artist%20X");
  });

  it("player bar onNowPlaying dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("pb-now-playing"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/nowplaying");
  });

  it("player bar onSelectArtist dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("pb-select-artist"));
    expectOverlayDismissed();
  });

  it("player bar onSelectAlbumById (async lookup) dismisses the overlay once resolved", async () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("pb-select-album-by-id"));
    await waitFor(() => expectOverlayDismissed());
    expect(screen.getByTestId("route-content")).toHaveTextContent("/album/srv%3Aalb2");
  });

  it("search results' own onSelectAlbum handler still self-clears (regression: fixed once already)", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("sr-select-album"));
    expectOverlayDismissed();
  });

  it("search results' own onSelectArtist handler still self-clears", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("sr-select-artist"));
    expectOverlayDismissed();
  });

  it("Alt+ArrowLeft dismisses the overlay by navigating back", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 1 });
    expectOverlayOpen();
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("Alt+ArrowRight dismisses the overlay by navigating forward", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 0 });
    expectOverlayOpen();
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artists");
  });

  it("plain ArrowLeft without Alt does not navigate or dismiss the overlay", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 1 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expectOverlayOpen();
  });

  it("mouse thumb button (button 3) dismisses the overlay by navigating back", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 1 });
    expectOverlayOpen();
    fireEvent.mouseUp(window, { button: 3 });
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("mouse thumb button (button 4) dismisses the overlay by navigating forward", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 0 });
    expectOverlayOpen();
    fireEvent.mouseUp(window, { button: 4 });
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artists");
  });

  it("command palette onNavigate to the route already open dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-navigate-library"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("command palette onSelectAlbum for the album already open dismisses the overlay", () => {
    renderHarness({ entries: ["/album/srv%3Aalb1"] });
    fireEvent.click(screen.getByTestId("cp-select-album"));
    expectOverlayDismissed();
  });

  it("sidebar item for the already-active view dismisses the overlay", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expectOverlayDismissed();
  });

  it("Alt+ArrowLeft at the first history entry dismisses the overlay even though nothing moves", () => {
    renderHarness({ entries: ["/library"], index: 0 });
    expectOverlayOpen();
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("Alt+ArrowRight at the last history entry dismisses the overlay even though nothing moves", () => {
    renderHarness({ entries: ["/library"], index: 0 });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expectOverlayDismissed();
  });

  it("mouse thumb button at the first history entry dismisses the overlay even though nothing moves", () => {
    renderHarness({ entries: ["/library"], index: 0 });
    fireEvent.mouseUp(window, { button: 3 });
    expectOverlayDismissed();
  });
});

/**
 * Two mechanisms dismiss the overlay and they cover different cases:
 *
 *   1. useAppNavigation itself, which dismisses on the *intent* to go
 *      somewhere - every navigation function it exposes, plus its own
 *      window-level Alt+Arrow and thumb-button handlers.
 *   2. useDismissOnNavigate, which fires on a pathname *change*.
 *
 * (2) looks redundant next to (1) now that (1) covers every source AppShell
 * hands out, and it is exactly the kind of thing a later cleanup deletes. It
 * is not redundant: a route can navigate on its own (AppRoutes sends the user
 * back to /playlists after deleting one), which never passes through
 * useAppNavigation at all.
 *
 * (1) is not redundant either, and that is the whole point of this pass:
 * navigating to the pathname already open - re-selecting the active sidebar
 * item, picking the album whose page is showing, Alt+ArrowLeft at the first
 * history entry - moves the router nowhere, so (2) cannot fire.
 *
 * These tests pin each mechanism against the case only it can handle, so
 * deleting either one turns this block red.
 */
describe("AppShell: both overlay-dismissal mechanisms are load-bearing", () => {
  it("dismisses on intent when the album picked is the one already open", () => {
    // Same pathname before and after, so useDismissOnNavigate cannot fire.
    renderHarness({ entries: ["/album/srv%3Aalb3"] });
    expectOverlayOpen();
    fireEvent.click(screen.getByTestId("sr-select-album"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/album/srv%3Aalb3");
  });

  it("dismisses on intent when the artist picked is the one already open", () => {
    renderHarness({ entries: ["/artist/Artist%20Z"] });
    expectOverlayOpen();
    fireEvent.click(screen.getByTestId("sr-select-artist"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artist/Artist%20Z");
  });

  it("dismisses on a pathname change driven by a route's own navigate, which no intent can see", () => {
    // The only navigation that does not pass through useAppNavigation.
    renderHarness({ entries: ["/library"] });
    expectOverlayOpen();
    fireEvent.click(screen.getByTestId("raw-navigate"));
    expectOverlayDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/playlists");
  });
});

describe("AppShell: dismissal does not wait on the destination route", () => {
  it("dismisses the overlay while the destination route is still loading", async () => {
    // Both the overlay and the routes sit under one already-mounted Suspense boundary, and
    // React keeps a boundary's committed content rather than showing its fallback while a
    // transition suspends. A dismissal scheduled in a transition lane therefore lands only
    // once the destination chunk resolves, leaving the overlay painted over the click the
    // user just made - the exact "the click reads as inert" symptom the dismissal exists for.
    renderHarness({ entries: ["/library"] });
    expectOverlayOpen();

    suspendControl.pathname = "/home";
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(screen.queryByRole("heading", { name: "Search" })).not.toBeInTheDocument();
    // The router has not moved yet, so the route the user came from is what stays painted.
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");

    await act(async () => {
      suspendControl.release?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("route-content")).toHaveTextContent("/home"));
  });
});
