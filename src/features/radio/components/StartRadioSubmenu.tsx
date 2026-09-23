import { RADIO_MODES } from "../../playback/store/playerTypes";
import type { RadioMode } from "../../playback/store/playerTypes";
import { ContextMenuSubmenu } from "../../../ui/ContextMenu";

interface Props {
  onSelect: (mode: RadioMode) => void;
}

export function StartRadioSubmenu({ onSelect }: Props) {
  return (
    <ContextMenuSubmenu label="Start radio">
      {RADIO_MODES.map(({ mode, label }) => (
        <button key={mode} onClick={() => onSelect(mode)}>
          {label}
        </button>
      ))}
    </ContextMenuSubmenu>
  );
}
