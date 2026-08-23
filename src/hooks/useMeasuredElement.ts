import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface MeasuredElement<T extends HTMLElement> {
  /** For consumers that need the node itself (a virtualizer's scroll element, `useScrollMemory`). */
  ref: RefObject<T | null>;
  /** Pass as the element's `ref`. Measures on attach and releases the observer on detach. */
  attach: (el: T | null) => void;
  width: number;
  height: number;
}

/**
 * Tracks an element's size, measuring it the moment it is attached.
 *
 * The obvious shape - a `useRef` plus a layout effect with empty deps - silently does
 * nothing for any view that renders a skeleton, an empty state or an error *instead of*
 * the element being measured: there is nothing to observe when the effect runs, and no dep
 * moves when the content finally arrives, so the size stays 0 for the life of the mount.
 * A callback ref has no deps to get wrong; it fires whenever the element appears, however
 * late that is. See known-issues, "An effect that bails on a ref the first render did not
 * fill never runs at all".
 */
export function useMeasuredElement<T extends HTMLElement>(): MeasuredElement<T> {
  const ref = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const attach = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    ref.current = el;
    if (!el) return;
    // Same-value writes are dropped so a resize that changes only one axis, or none,
    // cannot re-render every card in the grid reading this.
    const apply = (width: number, height: number) =>
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    // clientWidth/Height, not offsetWidth/Height: the observer below reports the content
    // box, and offset* is the border box, so on a scrolling element the two differ by the
    // scrollbar gutter. Measuring in different boxes made every mount compute once from
    // the wider number and again from the narrower one, relaying the grid after paint
    // whenever the pair straddled a column boundary.
    apply(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      const box = entry!.contentRect;
      apply(box.width, box.height);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // React calls `attach(null)` on unmount, but only for an element that is still rendered;
  // an unmount that happens while the view is back on its empty branch has already detached.
  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  return { ref, attach, width: size.width, height: size.height };
}
