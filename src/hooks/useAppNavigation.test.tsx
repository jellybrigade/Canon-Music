// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { AlbumRow } from "../types/library";
import type { PlaylistRow } from "../features/playlists/usePlaylists";
import { useAppNavigation } from "./useAppNavigation";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);

function wrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

describe("view mapping", () => {
  it("maps /search to view \"search\"", () => {
    const { result } = renderHook(() => useAppNavigation(() => {}), {
      wrapper: wrapper(["/search?q=abba"]),
    });
    expect(result.current.view).toBe("search");
  });

  it("still folds /album/:id into \"library\"", () => {
    const { result } = renderHook(() => useAppNavigation(() => {}), {
      wrapper: wrapper(["/album/a1"]),
    });
    expect(result.current.view).toBe("library");
  });
});

describe("leaveSearch", () => {
  it("navigates back one entry when /search is not the first entry", () => {
    const { result } = renderHook(() => useAppNavigation(() => {}), {
      wrapper: wrapper(["/library", "/search?q=abba"]),
    });
    act(() => result.current.leaveSearch());
    expect(result.current.pathname).toBe("/library");
  });

  it("navigates to /home when /search is the first history entry", () => {
    const { result } = renderHook(() => useAppNavigation(() => {}), {
      wrapper: wrapper(["/search?q=abba"]),
    });
    act(() => result.current.leaveSearch());
    expect(result.current.pathname).toBe("/home");
  });

  it("calls dismiss", () => {
    const dismiss = vi.fn();
    const { result } = renderHook(() => useAppNavigation(dismiss), {
      wrapper: wrapper(["/library", "/search?q=abba"]),
    });
    act(() => result.current.leaveSearch());
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

function album(id: string): AlbumRow {
  return { id, server_id: "srv-a", name: "Arrival", artist: "ABBA", year: null, artwork_url: null };
}

function playlist(id: string): PlaylistRow {
  return {
    id, server_id: "srv-a", name: "Mix", comment: null, track_count: 0,
    cover_art_url: null, custom_cover_data: null, is_smart: 0, rules_json: null,
  };
}

describe("asking for the route already showing", () => {
  // Every one of these pushed a second copy of the current entry, so Back landed on the page
  // the user was already looking at. Worst on /search: `leaveSearch` is `navigate(-1)`, so
  // Escape and the header Back button both left the user still in search.
  function nav(initialEntries: string[]) {
    return renderHook(
      () => ({ app: useAppNavigation(() => {}), search: useLocation().search }),
      { wrapper: wrapper(initialEntries) },
    );
  }

  it("pushes no second /search entry, so leaving search still lands on the page behind it", () => {
    const { result } = nav(["/library", "/search?q=abba"]);
    act(() => result.current.app.navigateTo("search"));
    expect(result.current.app.pathname).toBe("/search");

    act(() => result.current.app.leaveSearch());
    expect(result.current.app.pathname).toBe("/library");
  });

  it("keeps the query when the sidebar asks for search from inside search", () => {
    const { result } = nav(["/search?q=abba"]);
    act(() => result.current.app.navigateTo("search"));
    expect(result.current.search).toBe("?q=abba");
  });

  it("pushes no second entry for the browse view already open", () => {
    const { result } = nav(["/home", "/library"]);
    act(() => result.current.app.navigateTo("library"));
    act(() => result.current.app.goBack());
    expect(result.current.app.pathname).toBe("/home");
  });

  it("pushes no second entry for the album page already open", () => {
    const { result } = nav(["/home", "/album/a1"]);
    act(() => result.current.app.openAlbum(album("a1")));
    act(() => result.current.app.goBack());
    expect(result.current.app.pathname).toBe("/home");
  });

  it("pushes no second entry for the artist page already open", () => {
    const { result } = nav(["/home", "/artist/ABBA"]);
    act(() => result.current.app.openArtist("ABBA"));
    act(() => result.current.app.goBack());
    expect(result.current.app.pathname).toBe("/home");
  });

  it("pushes no second entry for the playlist page already open", () => {
    const { result } = nav(["/home", "/playlist/p1"]);
    act(() => result.current.app.openPlaylist(playlist("p1")));
    act(() => result.current.app.goBack());
    expect(result.current.app.pathname).toBe("/home");
  });

  it("still dismisses overlays when the navigation is a no-op", () => {
    const dismiss = vi.fn();
    const { result } = renderHook(() => useAppNavigation(dismiss), {
      wrapper: wrapper(["/library"]),
    });
    act(() => result.current.navigateTo("library"));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("leaveSearch after the route rewrites its own entry", () => {
  // `?q` is written with `replace`, and react-router mints a fresh `location.key` for it. That
  // erased the "default" marker for the entry the router mounted on, so a cold mount at /search
  // (the web-process-terminated -> reload() recovery) plus one keystroke left Escape and the
  // header Back button doing nothing at all.
  it("leaves for /home when the mount entry was replaced by the query write", () => {
    const { result } = renderHook(
      () => ({ app: useAppNavigation(() => {}), navigate: useNavigate() }),
      { wrapper: wrapper(["/search"]) },
    );
    act(() => result.current.navigate("/search?q=abba", { replace: true }));
    expect(result.current.app.pathname).toBe("/search");

    act(() => result.current.app.leaveSearch());
    expect(result.current.app.pathname).toBe("/home");
  });

  it("still goes back one entry when search was pushed onto a replaced mount entry", () => {
    const { result } = renderHook(
      () => ({ app: useAppNavigation(() => {}), navigate: useNavigate() }),
      { wrapper: wrapper(["/search"]) },
    );
    act(() => result.current.navigate("/search?q=abba", { replace: true }));
    act(() => result.current.app.navigateTo("library"));
    act(() => result.current.navigate("/search?q=abba"));

    act(() => result.current.app.leaveSearch());
    expect(result.current.app.pathname).toBe("/library");
  });

  it("leaves for /home again after a pop back to the mount entry", () => {
    const { result } = renderHook(
      () => ({ app: useAppNavigation(() => {}), navigate: useNavigate() }),
      { wrapper: wrapper(["/search"]) },
    );
    act(() => result.current.navigate("/search?q=abba", { replace: true }));
    act(() => result.current.app.navigateTo("library"));
    act(() => result.current.app.goBack());

    act(() => result.current.app.leaveSearch());
    expect(result.current.app.pathname).toBe("/home");
  });
});
