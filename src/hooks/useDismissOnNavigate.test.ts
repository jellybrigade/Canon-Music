// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDismissOnNavigate } from "./useDismissOnNavigate";

describe("useDismissOnNavigate", () => {
  it("leaves the command palette alone on the first render", () => {
    const clear = vi.fn();
    renderHook(() => useDismissOnNavigate("/home", clear));
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears the command palette when the route changes under it", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useDismissOnNavigate(path, clear), {
      initialProps: { path: "/home" },
    });
    rerender({ path: "/album/abc" });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not re-clear while the route stays put", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useDismissOnNavigate(path, clear), {
      initialProps: { path: "/home" },
    });
    rerender({ path: "/album/abc" });
    rerender({ path: "/album/abc" });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  // Load-bearing now that /search is a route: the hook is keyed on the caller's `pathname`
  // argument, never the whole location, precisely so a `?q` change while staying on /search
  // cannot fire this and close the command palette on every keystroke. Passing the same
  // pathname string on every rerender, as App.tsx does regardless of the search params, is
  // this case; if a later "improvement" swapped the argument for `location.pathname + search`
  // this would go red.
  it("does not clear when only the query string would have changed, pathname held fixed", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useDismissOnNavigate(path, clear), {
      initialProps: { path: "/search" },
    });
    rerender({ path: "/search" });
    rerender({ path: "/search" });
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears again on each further navigation", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useDismissOnNavigate(path, clear), {
      initialProps: { path: "/home" },
    });
    rerender({ path: "/album/abc" });
    rerender({ path: "/artist/xyz" });
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("tracks the latest clear callback rather than the one from the last navigation", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ path, clear }: { path: string; clear: () => void }) => useDismissOnNavigate(path, clear),
      { initialProps: { path: "/home", clear: first } }
    );
    rerender({ path: "/album/abc", clear: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
