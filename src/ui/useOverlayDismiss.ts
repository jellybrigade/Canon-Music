import { useRef, useMemo } from "react";
import type { MouseEvent } from "react";

/**
 * Backdrop dismissal for portal modals: press and release must both target the backdrop, so a
 * drag from inside the dialog doesn't close it. Spread onto the backdrop element.
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
