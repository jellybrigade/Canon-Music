import type { RadioMode } from "../store/player";
import { ContextMenuSubmenu } from "./ContextMenu";

const RADIO_MODES: { mode: RadioMode; label: string }[] = [
  { mode: "curated",          label: "Curated" },
  { mode: "same-genre",       label: "Same Genre" },
  { mode: "similar-artists",  label: "Similar Artists" },
  { mode: "same-artist",      label: "Same Artist" },
  { mode: "same-album",       label: "Same Album" },
  { mode: "era",              label: "Same Era" },
  { mode: "loved",            label: "Loved Tracks" },
  { mode: "random",           label: "Random" },
];

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
