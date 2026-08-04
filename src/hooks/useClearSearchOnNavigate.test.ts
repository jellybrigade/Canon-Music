// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useClearSearchOnNavigate } from "./useClearSearchOnNavigate";

describe("useClearSearchOnNavigate", () => {
  it("leaves the search overlay alone on the first render", () => {
    const clear = vi.fn();
    renderHook(() => useClearSearchOnNavigate("/home", clear));
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears the search overlay when the route changes under it", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useClearSearchOnNavigate(path, clear), {
      initialProps: { path: "/home" },
    });
    rerender({ path: "/album/abc" });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not re-clear while the route stays put", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useClearSearchOnNavigate(path, clear), {
      initialProps: { path: "/home" },
    });
    rerender({ path: "/album/abc" });
    rerender({ path: "/album/abc" });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears again on each further navigation", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ path }) => useClearSearchOnNavigate(path, clear), {
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
      ({ path, clear }: { path: string; clear: () => void }) => useClearSearchOnNavigate(path, clear),
      { initialProps: { path: "/home", clear: first } }
    );
    rerender({ path: "/album/abc", clear: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
