// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/canonicalize";
import { CanonCombobox } from "./CanonCombobox";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const westCoastHipHop: TreeNode = {
  id: "west-coast-hip-hop",
  name: "West Coast Hip Hop",
  type: "genre",
  canonical_key: "west coast hip hop",
  parents: [],
  sections: ["scenes-and-movements"],
};

function openWithQuery(onSelect = vi.fn()) {
  render(<CanonCombobox treeNodes={[westCoastHipHop]} currentId={null} onSelect={onSelect} onClear={vi.fn()} />);
  const input = document.querySelector(".tags-combobox-input")!;
  fireEvent.change(input, { target: { value: "west coast hip hop" } });
  act(() => vi.advanceTimersByTime(0));
  return onSelect;
}

const dropdown = () => document.querySelector(".tags-combobox-dropdown");

describe("CanonCombobox dismissal", () => {
  it("treats a press inside the portaled dropdown as inside", () => {
    // The dropdown portals to document.body, outside the wrapper the outside-click check
    // watched, so pressing a row closed the list before the row could save the mapping.
    openWithQuery();

    fireEvent.mouseDown(dropdown()!);

    expect(dropdown()).not.toBeNull();
  });

  it("closes on a press outside both the input and the dropdown", () => {
    openWithQuery();

    fireEvent.mouseDown(document.body);

    expect(dropdown()).toBeNull();
  });

  it("selects the pressed row", () => {
    const onSelect = openWithQuery();

    fireEvent.mouseDown(document.querySelector(".tags-combobox-option")!);

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("west-coast-hip-hop");
  });
});
