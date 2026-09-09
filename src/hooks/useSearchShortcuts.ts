import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { isTextEntryTarget } from "../lib/keyboard";

export interface SearchShortcutOptions {
  /** The search route's input, when /search is mounted. Used for focus and for the guard. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** Whether the /search route is the current route. */
  searchActive: boolean;
  /** Whether the command palette is currently open. */
  commandPaletteOpen: boolean;
  /**
   * Whether any overlay is painted *over* the search route (the command palette, the feedback
   * modal). Escape belongs to the topmost layer, so search's own dismissal has to stand down
   * while one of these is up.
   */
  overlayAbove: boolean;
  toggleCommandPalette: () => void;
  openSearch: () => void;
  /** Navigates back out of /search. */
  leaveSearch: () => void;
}

/**
 * The window-level Ctrl/Cmd+K, Ctrl/Cmd+F and Escape shortcuts.
 *
 * Each branch guards focus *itself* rather than sharing one blanket bail, because the branches
 * disagree about what focus means:
 *
 * - **Ctrl+K** must not steal a keystroke from a text field, but the palette's own input is the
 *   only thing that can hold focus while the palette is open, so the toggle would lose its
 *   "close" half under a blanket guard.
 * - **Ctrl+F** must not steal a keystroke either, except from the search input it exists to
 *   focus - where re-pressing it usefully re-selects the text instead of pushing a duplicate
 *   history entry.
 * - **Escape** leaves the /search route, and is pressed from inside the search input almost
 *   every time. But Escape inside any *other* field belongs to that field (a rename box, a
 *   modal form), so the exemption is by ref identity, not by "an input has focus". And it
 *   belongs to whatever is stacked *above* /search before it belongs to /search at all - focus
 *   alone cannot answer that, because the layer on top may hold no focus (a click on its blank
 *   chrome) while the layer underneath may hold it (Ctrl+F focuses the search input through the
 *   palette). In both of those the ref-identity exemption is precisely what lets one keypress
 *   collapse the whole stack.
 *
 * Options are read through a ref, so the listener is registered once for the lifetime of the
 * app rather than being torn down and re-registered on every keystroke in the search box.
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
        // Topmost layer first. These overlays run their own Escape handlers (the palette on
        // `window`, registered later than this one; the feedback modal on `document`, so
        // earlier), and none of them stops propagation, so without this the press dismisses
        // the layer the user aimed at *and* leaves /search underneath it.
        if (overlayAbove) return;
        if (typing && e.target !== searchInputRef.current) return;
        leaveSearch();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
