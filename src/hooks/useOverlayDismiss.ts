import { useRef, useMemo } from "react";
import type { MouseEvent } from "react";

/**
 * Backdrop dismissal for the portal modals (`SmartPlaylistModal`, `IdentifyDialog`,
 * `ArtistMergeModal`, `TagDrawer`).
 *
 * Closing on `click` alone is wrong twice over. The click fires on the nearest common
 * ancestor of press and release, so a drag that starts inside the dialog - selecting text
 * in an input, dragging a slider - and releases over the backdrop closes the modal and
 * discards the form. And a `stopPropagation` on the dialog is a second mechanism that only
 * looks like it guards the same thing: it hides the ancestor click but not the drag.
 *
 * Both press and release must land on the backdrop itself, tested by target identity
 * (`e.target === e.currentTarget`), which is the same shape `ContextMenu` and
 * `CommandPalette` already use.
 *
 * Spread the result onto the backdrop element. The dialog inside then needs no handler of
 * its own; anything it does is a press whose target is not the backdrop.
 */
export function useOverlayDismiss(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  return useMemo(
    () => ({
      onMouseDown: (e: MouseEvent<HTMLElement>) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      },
      onClick: (e: MouseEvent<HTMLElement>) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onCloseRef.current();
      },
    }),
    [],
  );
}
