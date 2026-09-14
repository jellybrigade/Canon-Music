// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

// Pins the afterEach(cleanup) registration in setup.ts. Without it nothing unmounts between
// tests in a file, so timers, listeners and effects from an earlier test keep running.
test("renders a probe tree", () => {
  render(<div data-testid="leak-probe" />);
  expect(screen.getByTestId("leak-probe")).toBeInTheDocument();
});

test("unmounts the previous test's tree before the next one runs", () => {
  expect(document.body.querySelector("[data-testid='leak-probe']")).toBeNull();
});

// A test that resets the module registry must still get cleaned up. `cleanup` unmounts the trees
// recorded in RTL's own module scope, so resolving RTL after the reset hands back a fresh
// instance whose record is empty and the unmount silently does nothing.
test("unmounts a tree even when the test reset the module registry", () => {
  render(<div data-testid="reset-probe" />);
  vi.resetModules();
  expect(screen.getByTestId("reset-probe")).toBeInTheDocument();
});

test("unmounts the module-resetting test's tree before the next one runs", () => {
  expect(document.body.querySelector("[data-testid='reset-probe']")).toBeNull();
});
