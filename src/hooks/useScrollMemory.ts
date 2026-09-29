import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// Module-level, not persisted: session memory only, since a stored offset could point
// into a re-synced library. Bounded since keys include detail-route ids (/playlist/<id>).
const MAX_KEYS = 64;
const offsets = new Map<string, number>();

function remember(key: string, top: number) {
  // Delete before set so re-inserting refreshes insertion order, which is what
  // makes the oldest-first eviction below actually evict the least recent key.
  offsets.delete(key);
  offsets.set(key, top);
  while (offsets.size > MAX_KEYS) {
    const oldest = offsets.keys().next().value;
    if (oldest === undefined) break;
    offsets.delete(oldest);
  }
}

/** Remembers `ref`'s scrollTop under `key`; pass `ready` as "content has height" or restores clamp to 0. */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean
) {
  const restoredFor = useRef<string | null>(null);

  // Restore before paint so the view never renders at the top and then jumps.
  useLayoutEffect(() => {
    if (!ready) return;
    const el = ref.current;
    if (!el) return;
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    const saved = offsets.get(key);
    if (saved) el.scrollTop = saved;
  }, [ref, key, ready]);

  // `ready` gates the save too: a skeleton/empty-state render has no element on the first
  // pass, and an effect bailing on a null ref never re-runs unless `ready` is a dep.
  useEffect(() => {
    if (!ready) return;
    const el = ref.current;
    if (!el) return;
    let frame: number | null = null;
    // Seeded from the element rather than left over from the previous key, so a teardown
    // that never saw a scroll writes this scroller's own position and not another's.
    let lastTop = el.scrollTop;
    function onScroll() {
      if (!el) return;
      // Read synchronously: by the time the teardown below runs, React has already
      // detached the node, and a detached element reports scrollTop 0 however far the
      // user had scrolled. Re-reading the DOM there erased the offset it meant to save.
      lastTop = el.scrollTop;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        remember(key, lastTop);
      });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
      // The rAF may never run if the unmount follows the last scroll event
      // within one frame, which is exactly what a fast click-through does.
      remember(key, lastTop);
    };
  }, [ref, key, ready]);
}
