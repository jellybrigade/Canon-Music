import { RADIO_MODES } from "../store/player";
import type { RadioMode } from "../store/player";
import { ContextMenuSubmenu } from "./ContextMenu";

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
