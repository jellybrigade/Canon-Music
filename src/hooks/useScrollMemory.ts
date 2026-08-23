import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// Scroll offsets survive unmount so returning to a browse view lands where the
// user left it. Deliberately module-level and not persisted: this is session
// memory, not a setting, and a stored offset from a previous run would point
// into a library that may have been re-sorted or re-synced since.
//
// Bounded because the key includes ids for detail routes (/playlist/<id>), so
// a long session browsing many playlists would otherwise grow it without limit.
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

/**
 * Remembers `ref`'s scrollTop under `key` and restores it on the next mount.
 *
 * `ready` gates both halves: a virtualized scroller has no scrollable height
 * until its rows exist, so setting scrollTop before then is silently clamped to
 * 0, and a view that renders its scroller only once it has content has no
 * element to listen on before then either. Pass the condition that means
 * "content has height" (rows.length > 0), not merely "the element is mounted".
 */
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

  // `ready` gates the save too, and not only as an optimisation: a view that renders a
  // skeleton or an empty state instead of its scroller has no element on the first pass,
  // and an effect that bails on a null ref never re-runs unless a dep moves. Without
  // `ready` in the deps, `ArtistGrid` never attached this listener at all and recorded no
  // offset for the restore above to find.
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
