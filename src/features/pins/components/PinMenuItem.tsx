import { isPinnedIn, type PinTarget } from "../pins";
import { usePins, useSetPinned } from "../usePins";

export function PinMenuItem({ target, onDone }: { target: PinTarget; onDone: () => void }) {
  const { data: pins } = usePins(target.serverId);
  const setPinned = useSetPinned();
  const isPinned = pins ? isPinnedIn(pins, target) : false;
  return (
    <button
      disabled={!pins}
      onClick={() => {
        setPinned(target, !isPinned).catch((err: unknown) => console.error("pins: couldn't save the pin", err));
        onDone();
      }}
    >
      {isPinned ? "Unpin" : "Pin"}
    </button>
  );
}
