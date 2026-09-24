// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useOverlayDismiss } from "./useOverlayDismiss";

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const dismiss = useOverlayDismiss(onClose);
  return (
    <div data-testid="backdrop" {...dismiss}>
      <div data-testid="dialog">
        <input data-testid="field" />
      </div>
    </div>
  );
}

const backdrop = () => screen.getByTestId("backdrop");
const dialog = () => screen.getByTestId("dialog");
const field = () => screen.getByTestId("field");

describe("useOverlayDismiss", () => {
  it("closes when press and release both land on the backdrop", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when a drag starts inside the dialog and releases on the backdrop", () => {
    // The click fires on the backdrop because it is the common ancestor of press and
    // release. Dismissing on that click is what discarded half-typed forms.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(field());
    fireEvent.mouseUp(backdrop());
    fireEvent.click(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on a click that stays inside the dialog", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(dialog());
    fireEvent.click(dialog());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes on a backdrop press that follows a drag out of the dialog", () => {
    // The press flag is per-press, not sticky: a rejected drag must not disarm the next
    // legitimate backdrop click.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(field());
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a backdrop click with no press before it", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.click(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls the latest onClose after a re-render rather than the one from mount", () => {
    // The handlers are memoized once, so a stale closure here would keep calling the
    // callback the modal was mounted with.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onClose={first} />);

    rerender(<Harness onClose={second} />);
    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("hands back the same handler identity across re-renders", () => {
    // Memoized so spreading it onto the backdrop does not churn listeners every render.
    const seen: unknown[] = [];
    function Probe() {
      const dismiss = useOverlayDismiss(() => {});
      seen.push(dismiss.onClick);
      return <div />;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });
});
