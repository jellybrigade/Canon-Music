import { useState } from "react";

/** The cover picker and Identify for one album at a time; Identify opened from the picker, which offers it
 * when sources need the album's MusicBrainz identity, returns to the picker on close. */
export function useCoverPickerDialogs<Target>() {
  const [pickerTarget, setPickerTarget] = useState<Target | null>(null);
  const [identify, setIdentify] = useState<{ target: Target; returnsToPicker: boolean } | null>(null);
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
