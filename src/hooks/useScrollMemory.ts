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
      // The virtualized grids (AlbumGrid/ArtistGrid) need a few frames after
      // mount to reach full scroll height: container width -> column count ->
      // row layout -> virtualizer total size. Assigning scrollTop before that
      // height exists clamps it to 0, so retry across frames until the position
      // sticks, or the content is simply too short to reach it.
      let attempts = 0;
      const tryRestore = () => {
        el.scrollTop = saved;
        const reached = Math.abs(el.scrollTop - saved) < 1;
        const maxed = el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
        if (!reached && !maxed && attempts < 30) {
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
