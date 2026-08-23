import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { isTextEntryTarget } from "../lib/keyboard";

export interface SearchShortcutOptions {
  /** The search bar's input, when the overlay is mounted. Used for focus and for the guard. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** Whether the search overlay is currently showing (open, or holding a query). */
  searchActive: boolean;
  /** Whether the command palette is currently open. */
  commandPaletteOpen: boolean;
  /**
   * Whether any overlay is painted *over* the search overlay (the command palette, the
   * feedback modal). Escape belongs to the topmost layer, so the search overlay's own
   * dismissal has to stand down while one of these is up.
   */
  overlayAbove: boolean;
  toggleCommandPalette: () => void;
  openSearch: () => void;
  clearSearch: () => void;
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
 *   focus - where re-pressing it usefully re-selects the text.
 * - **Escape** dismisses the search overlay, and is pressed from inside the search input almost
 *   every time. But Escape inside any *other* field belongs to that field (a rename box, a
 *   modal form), so the exemption is by ref identity, not by "an input has focus". And it
 *   belongs to whatever is stacked *above* the search overlay before it belongs to the search
 *   overlay at all - focus alone cannot answer that, because the layer on top may hold no
 *   focus (a click on its blank chrome) while the layer underneath may hold it (Ctrl+F focuses
 *   the search input through the palette). In both of those the ref-identity exemption is
 *   precisely what lets one keypress collapse the whole stack.
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
        clearSearch,
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
        openSearch();
        // The input mounts with the overlay, so focus has to wait for the commit.
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
        return;
      }

      if (e.key === "Escape" && searchActive) {
        // Topmost layer first. These overlays run their own Escape handlers (the palette on
        // `window`, registered later than this one; the feedback modal on `document`, so
        // earlier), and none of them stops propagation, so without this the press dismisses
        // the layer the user aimed at *and* throws away the search underneath it.
        if (overlayAbove) return;
        if (typing && e.target !== searchInputRef.current) return;
        clearSearch();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
