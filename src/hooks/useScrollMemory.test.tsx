// @vitest-environment jsdom
/**
 * Coverage for `src/hooks/useScrollMemory.ts`.
 *
 * The restore half is already gated on `ready`, because a virtualized scroller has no
 * scrollable height until its rows exist. The save half has the same problem one step
 * earlier: a view that renders a skeleton or an empty state *instead of* its scroller has
 * no element to listen on at first paint, and an effect that bails on a null ref never
 * re-runs unless something in its deps moves. `ArtistGrid` is shaped exactly that way, so
 * it recorded no offsets at all and its restore could only ever be a no-op.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { useScrollMemory } from "./useScrollMemory";

/**
 * A view that, like `ArtistGrid`, renders its scroller only once it has content.
 *
 * jsdom lays nothing out, so a real `scrollTop` assignment on this div is dropped. The
 * callback ref installs a recording accessor instead, and React attaches refs before it
 * runs the layout effect of the same commit - which is the only window in which the
 * restore can be observed.
 */
function LateScroller({
  memKey,
  ready,
  scrollTop = 0,
  writes,
}: {
  memKey: string;
  ready: boolean;
  scrollTop?: number;
  writes?: number[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref, memKey, ready);
  if (!ready) return <p>Loading</p>;
  return (
    <div
      data-testid="scroller"
      ref={(el) => {
        if (el && !Object.getOwnPropertyDescriptor(el, "scrollTop")) {
          let current = scrollTop;
          Object.defineProperty(el, "scrollTop", {
            configurable: true,
            // A detached element has no layout box, so CSSOM reports 0 no matter how far
            // it was scrolled while connected. jsdom does not model that on its own, and
            // without it a teardown that re-reads the DOM looks like it still works.
            get: () => (el.isConnected ? current : 0),
            set: (v: number) => { writes?.push(v); current = v; },
          });
        }
        ref.current = el;
      }}
    />
  );
}

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid='scroller']")!;
}

async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

afterEach(cleanup);

describe("useScrollMemory", () => {
  it("records the offset of a scroller that only appears once content arrives", async () => {
    const view = render(<LateScroller memKey="late-1" ready={false} />);
    view.rerender(<LateScroller memKey="late-1" ready={true} scrollTop={240} />);
    await act(async () => { scroller().dispatchEvent(new Event("scroll")); });
    await nextFrame();
    view.unmount();

    const restored: number[] = [];
    render(<LateScroller memKey="late-1" ready={true} writes={restored} />);
    expect(restored).toEqual([240]);
  });

  it("keeps the offset it recorded when the scroller leaves the tree mid-mount", async () => {
    const view = render(<LateScroller memKey="late-3" ready={false} />);
    view.rerender(<LateScroller memKey="late-3" ready={true} scrollTop={310} />);
    await act(async () => { scroller().dispatchEvent(new Event("scroll")); });
    await nextFrame();

    // An empty refetch drops the scroller back to the loading branch; the teardown that
    // fires must not mistake the detached element's 0 for the user's position.
    view.rerender(<LateScroller memKey="late-3" ready={false} />);
    view.unmount();

    const restored: number[] = [];
    render(<LateScroller memKey="late-3" ready={true} writes={restored} />);
    expect(restored).toEqual([310]);
  });

  it("attaches exactly one scroll listener across a ready flip", async () => {
    const view = render(<LateScroller memKey="late-2" ready={false} />);
    view.rerender(<LateScroller memKey="late-2" ready={true} />);
    const el = scroller();
    const add = vi.spyOn(el, "addEventListener");
    const remove = vi.spyOn(el, "removeEventListener");
    view.rerender(<LateScroller memKey="late-2" ready={true} />);
    expect(add).toHaveBeenCalledTimes(0);
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
