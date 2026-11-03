import { useState } from "react";

/** The cover picker and Identify for one album at a time; Identify opened from the picker, which offers it
 * when sources need the album's MusicBrainz identity, returns to the picker on close. A change of `scope`
 * (the page's album) closes both, so leaving an album and coming back doesn't reopen them. */
export function useCoverPickerDialogs<Target>(scope?: string) {
  const [pickerTarget, setPickerTarget] = useState<Target | null>(null);
  const [identify, setIdentify] = useState<{ target: Target; returnsToPicker: boolean } | null>(null);
  const [openedIn, setOpenedIn] = useState(scope);
  if (openedIn !== scope) {
    setOpenedIn(scope);
    setPickerTarget(null);
    setIdentify(null);
  }
  return {
    pickerTarget,
    identifyTarget: identify?.target ?? null,
    openPicker: (target: Target) => setPickerTarget(target),
    closePicker: () => setPickerTarget(null),
    openIdentify: (target: Target) => setIdentify({ target, returnsToPicker: false }),
    identifyFromPicker: () => {
      if (pickerTarget === null) return;
      setIdentify({ target: pickerTarget, returnsToPicker: true });
      setPickerTarget(null);
    },
    closeIdentify: () => {
      if (identify?.returnsToPicker) setPickerTarget(identify.target);
      setIdentify(null);
    },
  };
}
