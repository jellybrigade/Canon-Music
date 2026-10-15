// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadApp } from "../lib/reloadApp";
import { ROUTES } from "../lib/routes";
import { renderCatching } from "../test/renderCatching";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("../lib/reloadApp", () => ({ reloadApp: vi.fn() }));

vi.mock("../lib/logger", () => ({
  formatLogValue: String,
  logger: { error: vi.fn(), flush: vi.fn(() => Promise.resolve()) },
}));

function CrashesOn({ pathname }: { pathname: string }) {
  if (window.location.pathname === pathname) throw new Error(`broken at ${pathname}`);
  return <p>content</p>;
}

function CrashesEverywhere(): never {
  throw new Error("broken everywhere");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(reloadApp).mockClear();
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("leaves a page that crashes every render when asked to try again", () => {
    window.history.replaceState(null, "", "/artist/broken");
    const { caught } = renderCatching(
      <ErrorBoundary>
        <CrashesOn pathname="/artist/broken" />
      </ErrorBoundary>,
    );
    expect(caught).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Go to Home" }));

    expect(screen.getByText("content")).toBeInTheDocument();
    expect(window.location.pathname).toBe(ROUTES.HOME);
    expect(caught).toHaveLength(1);
  });

  it("keeps the router's history entry state when leaving the crashed page", () => {
    const routerState = { usr: null, key: "abc", idx: 2 };
    window.history.replaceState(routerState, "", "/artist/broken");
    renderCatching(
      <ErrorBoundary>
        <CrashesOn pathname="/artist/broken" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to Home" }));

    expect(window.history.state).toEqual(routerState);
  });

  it("offers a full reload once Home crashes too", () => {
    window.history.replaceState(null, "", "/artist/broken");
    const { caught } = renderCatching(
      <ErrorBoundary>
        <CrashesEverywhere />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to Home" }));
    expect(caught).toHaveLength(2);
    expect(reloadApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reload Canon" }));
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("offers a reload straight away when the first crash is already on Home", () => {
    window.history.replaceState(null, "", ROUTES.HOME);
    renderCatching(
      <ErrorBoundary>
        <CrashesOn pathname={ROUTES.HOME} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "Reload Canon" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to Home" })).not.toBeInTheDocument();
  });
});
