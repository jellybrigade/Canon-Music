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
    if (saved != null) el.scrollTop = saved;
    return () => {
      useScrollMemoryStore.getState().save(savedKey, el.scrollTop);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
