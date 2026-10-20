// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetModalRegistry, useAnyModalOpen } from "../../../ui/useModalChrome";
import { NodeModal } from "./TagTreeTab";

beforeEach(() => __resetModalRegistry());
afterEach(cleanup);

function Probe() {
  return <span data-testid="any-modal">{String(useAnyModalOpen())}</span>;
}

function renderModal(onCancel = vi.fn()) {
  render(<NodeModal treeNodes={[]} onSave={vi.fn()} onCancel={onCancel} />);
  return onCancel;
}

const backdrop = () => document.querySelector(".node-modal-backdrop")!;
const dialog = () => document.querySelector(".node-modal")!;
const nameInput = () => document.querySelector(".node-modal-input")!;

describe("NodeModal", () => {
  it("closes on Escape pressed in the name field", () => {
    const onCancel = renderModal();

    fireEvent.keyDown(nameInput(), { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed away from the name field", () => {
    // The Escape handler used to live on the name input's onKeyDown alone, so Escape from
    // the Type buttons or the parent combobox did nothing at all.
    const onCancel = renderModal();
    const typeButton = screen.getByRole("button", { name: "Descriptor" });
    typeButton.focus();

    fireEvent.keyDown(typeButton, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes when press and release both land on the backdrop", () => {
    const onCancel = renderModal();

    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stays open when a press on the backdrop releases inside the dialog", () => {
    // Dismissing on mousedown alone closes on the press half of a gesture whose release
    // the user aimed into the form.
    const onCancel = renderModal();

    fireEvent.mouseDown(backdrop());

    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(dialog());

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("stays open when a drag starts inside the dialog and releases on the backdrop", () => {
    const onCancel = renderModal();

    fireEvent.mouseDown(nameInput());
    fireEvent.click(backdrop());

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("registers as an open modal so the layers underneath stand down", () => {
    render(
      <>
        <Probe />
        <NodeModal treeNodes={[]} onSave={vi.fn()} onCancel={vi.fn()} />
      </>,
    );

    expect(screen.getByTestId("any-modal")).toHaveTextContent("true");
  });
});

describe("NodeModal parent picker", () => {
  afterEach(() => vi.useRealTimers());

  it("treats a press inside the portaled parent list as inside", () => {
    // The list portals to document.body, outside the wrapper the outside-click check
    // watched, so pressing a parent closed the list before the pick landed.
    vi.useFakeTimers();
    const hipHop = {
      id: "hip-hop",
      name: "Hip Hop",
      type: "genre",
      canonical_key: "hip hop",
      parents: [],
      sections: ["genres" as const],
    };
    render(<NodeModal treeNodes={[hipHop]} onSave={vi.fn()} onCancel={vi.fn()} />);
    const parentInput = screen.getByPlaceholderText("Search for parent node…");
    fireEvent.change(parentInput, { target: { value: "hip" } });
    act(() => vi.advanceTimersByTime(0));

    fireEvent.mouseDown(document.querySelector(".tags-combobox-dropdown")!);

    expect(document.querySelector(".tags-combobox-dropdown")).not.toBeNull();
  });
});
