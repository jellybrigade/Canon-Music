// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

// Pins the afterEach(cleanup) registration in setup.ts. Without it nothing unmounts between
// tests in a file, so timers, listeners and effects from an earlier test keep running.
test("renders a probe tree", () => {
  render(<div data-testid="leak-probe" />);
  expect(screen.getByTestId("leak-probe")).toBeInTheDocument();
});

test("unmounts the previous test's tree before the next one runs", () => {
  expect(document.body.querySelector("[data-testid='leak-probe']")).toBeNull();
});
