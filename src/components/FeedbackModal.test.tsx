// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FeedbackModal } from "./FeedbackModal";
import { __resetModalRegistry, useAnyModalOpen } from "../ui/useModalChrome";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.48.3") }));
vi.mock("../lib/logger", () => ({ logger: { getRecent: () => Promise.resolve(""), error: vi.fn() } }));

beforeEach(() => __resetModalRegistry());
afterEach(cleanup);

function Probe() {
  return <span data-testid="any-modal">{String(useAnyModalOpen())}</span>;
}

const backdrop = () => document.querySelector(".feedback-overlay")!;
const dialog = () => document.querySelector(".feedback-modal")!;

describe("FeedbackModal", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when press and release both land on the backdrop", () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the report when a drag starts inside and releases on the backdrop", () => {
    // Selecting text in the steps field and releasing past the edge of the dialog fires a
    // click on the backdrop, because the backdrop is the common ancestor of press and
    // release. Dismissing on that click discards the whole half-written report.
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.mouseDown(dialog());
    fireEvent.click(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("registers as an open modal so the layers underneath stand down", () => {
    render(
      <>
        <Probe />
        <FeedbackModal onClose={vi.fn()} />
      </>,
    );

    expect(screen.getByTestId("any-modal")).toHaveTextContent("true");
  });

  it("leaves the registry empty once closed", () => {
    const { unmount } = render(<FeedbackModal onClose={vi.fn()} />);
    unmount();

    render(<Probe />);

    expect(screen.getByTestId("any-modal")).toHaveTextContent("false");
  });
});
