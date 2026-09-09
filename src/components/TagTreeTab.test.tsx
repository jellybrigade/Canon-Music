// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NodeModal } from "./TagTreeTab";
import { __resetModalRegistry, useAnyModalOpen } from "../hooks/useModalChrome";

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
