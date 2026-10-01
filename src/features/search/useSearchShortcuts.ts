import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { isTextEntryTarget } from "../../lib/keyboard";

export interface SearchShortcutOptions {
  /** The search route's input, when /search is mounted. Used for focus and for the guard. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** Whether the /search route is the current route. */
  searchActive: boolean;
  /** Whether the command palette is currently open. */
  commandPaletteOpen: boolean;
  /** Whether an overlay (command palette, feedback modal) sits above /search; its own
   * Escape must stand down for the topmost layer's. */
  overlayAbove: boolean;
  toggleCommandPalette: () => void;
  openSearch: () => void;
  /** Navigates back out of /search. */
  leaveSearch: () => void;
}

/**
 * Window-level Ctrl/Cmd+K, Ctrl/Cmd+F and Escape. Each branch guards focus itself: Escape
 * exempts only the search input (by ref), so other fields keep their own Escape.
 */
export function useSearchShortcuts(options: SearchShortcutOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const {
        searchInputRef,
        searchActive,
        commandPaletteOpen,
        overlayAbove,
        toggleCommandPalette,
        openSearch,
        leaveSearch,
      } = optionsRef.current;
      const typing = isTextEntryTarget(e);
      // Case-insensitive: with CapsLock on, or Shift held, `e.key` is "K", and a shortcut
      // that silently stops working under CapsLock reads as the app being broken.
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if ((e.ctrlKey || e.metaKey) && key === "k") {
        if (typing && !commandPaletteOpen) return;
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "f") {
        if (typing && e.target !== searchInputRef.current) return;
        e.preventDefault();
        if (searchActive) {
          // Already on /search: re-select rather than pushing a duplicate history entry.
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          return;
        }
        openSearch();
        return;
      }

      if (e.key === "Escape" && searchActive) {
        // These overlays run their own Escape handlers and don't stop propagation, so without
        // this guard the press would dismiss the top layer *and* leave /search underneath it.
        if (overlayAbove) return;
        if (typing && e.target !== searchInputRef.current) return;
        leaveSearch();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
