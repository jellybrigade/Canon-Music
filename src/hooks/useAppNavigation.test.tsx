// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
