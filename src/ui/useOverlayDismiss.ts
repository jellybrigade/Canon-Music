import type { MouseEvent } from "react";
import { useMemo, useRef } from "react";

/**
 * Backdrop dismissal for portal modals: press and release must both target the backdrop, so a
 * drag from inside the dialog doesn't close it. Spread onto the backdrop element. Pass the same
 * `closable` as `useModalChrome`, so a click outside can't close a dialog its buttons can't.
 */
export function useOverlayDismiss(onClose: () => void, { closable = true }: { closable?: boolean } = {}) {
  const pressedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closableRef = useRef(closable);
  closableRef.current = closable;

  return useMemo(
    () => ({
      onMouseDown: (e: MouseEvent<HTMLElement>) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      },
      onClick: (e: MouseEvent<HTMLElement>) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current && closableRef.current) onCloseRef.current();
      },
    }),
    [],
  );
}
