// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useState } from "react";
import { AppShell } from "./AppShell";
import type { AppViewProps } from "./AppRoutes";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useDismissOnNavigate } from "../hooks/useDismissOnNavigate";

/**
 * Guards known-issues.md's "State deciding which subtree renders, but absent
 * from the URL, must be dismissed by navigation itself". The command palette is now the
 * only piece of state fitting that description - search left the class by becoming the
 * /search route (see App.searchRoute.test.tsx for its own coverage). Every source that
 * can navigate must still dismiss the palette - table-driven so a new source added later
 * fails until it is wired.
 *
 * Mounts AppShell wired to the *real* useAppNavigation + useDismissOnNavigate, the same
 * composition App.tsx uses, so this catches wiring bugs a leaf-level unit test of either
 * hook alone cannot.
 */

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);

// AppRoutes is `lazy`, under the same already-mounted Suspense boundary the command
// palette renders in. `suspendControl` lets one test hold the destination route
// unresolved so the dismissal can be observed while it is still loading.
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

vi.mock("../features/playback/components/PlayerBar", () => ({
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
  CommandPalette: (props: any) =>
    !props.open ? null : (
      <div data-testid="command-palette-stub">
        <button data-testid="cp-navigate" onClick={() => props.onNavigate("home")}>nav-home</button>
        <button data-testid="cp-navigate-library" onClick={() => props.onNavigate("library")}>nav-library</button>
        <button data-testid="cp-select-album" onClick={() => props.onSelectAlbum({ id: "srv:alb1", title: "A" })}>album</button>
        <button data-testid="cp-select-artist" onClick={() => props.onSelectArtist("Artist X", 3)}>artist</button>
      </div>
    ),
}));

vi.mock("../features/playback/hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));

afterEach(() => {
  cleanup();
  suspendControl.pathname = null;
  suspendControl.pending = null;
  suspendControl.release = null;
});

// AppShell's Suspense boundary wraps CommandPalette (lazy) and AppRoutes' own lazy chunks.
// Warm both lazy caches once so every real test below can assert synchronously.
beforeAll(async () => {
  render(
    <MemoryRouter initialEntries={["/library"]}>
      <Inner startPaletteOpen={false} />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId("route-content")).toBeInTheDocument());
  cleanup();
  render(
    <MemoryRouter initialEntries={["/library"]}>
      <Inner startPaletteOpen={true} />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId("command-palette-stub")).toBeInTheDocument());
  cleanup();
});

function makeAlbumRow(id: string) {
  return { id, server_id: "srv", title: id } as unknown as Parameters<ReturnType<typeof useAppNavigation>["openAlbum"]>[0];
}

async function mockLookupAlbum(id: string) {
  return makeAlbumRow(id);
}

function Inner({ startPaletteOpen }: { startPaletteOpen?: boolean }) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(Boolean(startPaletteOpen));
  const dismissOverlays = () => setCommandPaletteOpen(false);
  const { view, pathname, navigateTo, openAlbum, openArtist } = useAppNavigation(dismissOverlays);
  useDismissOnNavigate(pathname, dismissOverlays);
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
    commandPaletteOpen,
    setCommandPaletteOpen,
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

function renderHarness(opts: { entries: string[]; index?: number; startPaletteOpen?: boolean }) {
  return render(
    <MemoryRouter initialEntries={opts.entries} initialIndex={opts.index}>
      <Inner startPaletteOpen={opts.startPaletteOpen ?? true} />
    </MemoryRouter>
  );
}

function expectPaletteOpen() {
  expect(screen.getByTestId("command-palette-stub")).toBeInTheDocument();
}

function expectPaletteDismissed() {
  expect(screen.queryByTestId("command-palette-stub")).not.toBeInTheDocument();
}

describe("AppShell: command palette dismissed by every navigation source", () => {
  it("starts with the palette open", () => {
    renderHarness({ entries: ["/library"] });
    expectPaletteOpen();
  });

  it("sidebar nav button click dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/home");
  });

  it("command palette onNavigate dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-navigate"));
    expectPaletteDismissed();
  });

  it("command palette onSelectAlbum dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-select-album"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/album/srv%3Aalb1");
  });

  it("command palette onSelectArtist dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-select-artist"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artist/Artist%20X");
  });

  it("player bar onNowPlaying dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("pb-now-playing"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/nowplaying");
  });

  it("player bar onSelectArtist dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("pb-select-artist"));
    expectPaletteDismissed();
  });

  it("player bar onSelectAlbumById (async lookup) dismisses the palette once resolved", async () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("pb-select-album-by-id"));
    await waitFor(() => expectPaletteDismissed());
    // The two settle at different times on purpose: the dismissal renders urgently so the click
    // never reads as inert, while the router commits the location as a transition. So the route
    // is still painting the path this navigation came *from* when the dismissal lands, and the
    // destination has to be waited for rather than read off the same tick.
    await waitFor(() =>
      expect(screen.getByTestId("route-content")).toHaveTextContent("/album/srv%3Aalb2")
    );
  });

  it("Alt+ArrowLeft dismisses the palette by navigating back", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 1 });
    expectPaletteOpen();
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("Alt+ArrowRight dismisses the palette by navigating forward", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 0 });
    expectPaletteOpen();
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artists");
  });

  it("plain ArrowLeft without Alt does not navigate or dismiss the palette", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 1 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expectPaletteOpen();
  });

  it("mouse thumb button (button 3) dismisses the palette by navigating back", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 1 });
    expectPaletteOpen();
    fireEvent.mouseUp(window, { button: 3 });
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("mouse thumb button (button 4) dismisses the palette by navigating forward", () => {
    renderHarness({ entries: ["/library", "/artists"], index: 0 });
    expectPaletteOpen();
    fireEvent.mouseUp(window, { button: 4 });
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artists");
  });

  it("command palette onNavigate to the route already open dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByTestId("cp-navigate-library"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("command palette onSelectAlbum for the album already open dismisses the palette", () => {
    renderHarness({ entries: ["/album/srv%3Aalb1"] });
    fireEvent.click(screen.getByTestId("cp-select-album"));
    expectPaletteDismissed();
  });

  it("sidebar item for the already-active view dismisses the palette", () => {
    renderHarness({ entries: ["/library"] });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expectPaletteDismissed();
  });

  it("Alt+ArrowLeft at the first history entry dismisses the palette even though nothing moves", () => {
    renderHarness({ entries: ["/library"], index: 0 });
    expectPaletteOpen();
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");
  });

  it("Alt+ArrowRight at the last history entry dismisses the palette even though nothing moves", () => {
    renderHarness({ entries: ["/library"], index: 0 });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expectPaletteDismissed();
  });

  it("mouse thumb button at the first history entry dismisses the palette even though nothing moves", () => {
    renderHarness({ entries: ["/library"], index: 0 });
    fireEvent.mouseUp(window, { button: 3 });
    expectPaletteDismissed();
  });
});

/**
 * Two mechanisms dismiss the palette and they cover different cases:
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
describe("AppShell: both palette-dismissal mechanisms are load-bearing", () => {
  it("dismisses on intent when the album picked is the one already open", () => {
    // Same pathname before and after, so useDismissOnNavigate cannot fire.
    renderHarness({ entries: ["/album/srv%3Aalb1"] });
    expectPaletteOpen();
    fireEvent.click(screen.getByTestId("cp-select-album"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/album/srv%3Aalb1");
  });

  it("dismisses on intent when the artist picked is the one already open", () => {
    renderHarness({ entries: ["/artist/Artist%20X"] });
    expectPaletteOpen();
    fireEvent.click(screen.getByTestId("cp-select-artist"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/artist/Artist%20X");
  });

  it("dismisses on a pathname change driven by a route's own navigate, which no intent can see", () => {
    // The only navigation that does not pass through useAppNavigation.
    renderHarness({ entries: ["/library"] });
    expectPaletteOpen();
    fireEvent.click(screen.getByTestId("raw-navigate"));
    expectPaletteDismissed();
    expect(screen.getByTestId("route-content")).toHaveTextContent("/playlists");
  });
});

describe("AppShell: dismissal does not wait on the destination route", () => {
  it("dismisses the palette while the destination route is still loading", async () => {
    // Both the palette and the routes sit under one already-mounted Suspense boundary, and
    // React keeps a boundary's committed content rather than showing its fallback while a
    // transition suspends. A dismissal scheduled in a transition lane therefore lands only
    // once the destination chunk resolves, leaving the palette painted over the click the
    // user just made - the exact "the click reads as inert" symptom the dismissal exists for.
    renderHarness({ entries: ["/library"] });
    expectPaletteOpen();

    suspendControl.pathname = "/home";
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(screen.queryByTestId("command-palette-stub")).not.toBeInTheDocument();
    // The router has not moved yet, so the route the user came from is what stays painted.
    expect(screen.getByTestId("route-content")).toHaveTextContent("/library");

    await act(async () => {
      suspendControl.release?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("route-content")).toHaveTextContent("/home"));
  });
});
