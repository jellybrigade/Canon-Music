import { useEffect, useRef } from "react";
import { useScrollMemoryStore } from "../store/scrollMemoryStore";

/**
 * Saves and restores the scroll position of a container element, keyed by `key`.
 * When `key` changes, the old position is saved and the new key's position is restored.
 */
export function useScrollMemory(
  key: string | undefined,
  containerRef: React.RefObject<HTMLElement | null>,
): void {
  // Keep a ref so the cleanup closure always sees the key that was active when
  // this effect ran, not whatever key is current at unmount time.
  const keyRef = useRef(key);

  useEffect(() => {
    const el = containerRef.current;
    const savedKey = key;
    keyRef.current = key;
    if (!savedKey || !el) return;
    // Read/write imperatively (not via the hook selector) so scroll bookkeeping
    // never triggers a re-render, matching the old module-level Map's behavior.
    const saved = useScrollMemoryStore.getState().positions[savedKey];
    let raf = 0;
    if (saved != null && saved > 0) {
      // On remount the scroller starts empty: its data (SQLite reads) and the
      // virtualized grid's full height (container width -> column count -> row
      // layout -> total size) only arrive over the next several frames.
      // Assigning scrollTop before the scroller can actually reach `saved`
      // clamps it to 0, so wait until the content is tall enough, THEN assign
      // once. Give up after ~1s if it never gets that tall (fewer items now).
      let attempts = 0;
      const tryRestore = () => {
        if (el.scrollHeight - el.clientHeight >= saved) {
          el.scrollTop = saved;
          return;
        }
        if (attempts < 60) {
          attempts++;
          raf = requestAnimationFrame(tryRestore);
        }
      };
      raf = requestAnimationFrame(tryRestore);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      useScrollMemoryStore.getState().save(savedKey, el.scrollTop);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
