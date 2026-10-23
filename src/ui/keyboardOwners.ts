import { useEffect, useSyncExternalStore } from "react";
import { useAnyModalOpen } from "./useModalChrome";

// Overlays that take the keyboard without being modals (the command palette, context menus).
// Counted apart from the modal registry, which decides whose Escape closes what.
let ownerCount = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return ownerCount > 0;
}

/** Marks the calling overlay as owning the keyboard while `isOwning` holds. */
export function useOwnKeyboard(isOwning: boolean) {
  useEffect(() => {
    if (!isOwning) return;
    ownerCount += 1;
    notify();
    return () => {
      ownerCount -= 1;
      notify();
    };
  }, [isOwning]);
}

/** Whether a modal or another overlay owns the keyboard, so shortcuts behind it stand down. */
export function useOverlayAbove(): boolean {
  const isAnyModalOpen = useAnyModalOpen();
  const isOwned = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return isAnyModalOpen || isOwned;
}

/** Test-only reset, so a leaked claim in one case cannot silently pass the next. */
export function __resetKeyboardOwners() {
  ownerCount = 0;
  notify();
}
