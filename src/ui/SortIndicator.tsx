import { ChevronDown, ChevronUp } from "lucide-react";
import type { SortDirection } from "../lib/trackSort";

export function SortIndicator({ direction }: { direction: SortDirection | null }) {
  if (direction === null) return null;
  return direction === "asc" ? (
    <ChevronUp size={11} className="track-sort-indicator" />
  ) : (
    <ChevronDown size={11} className="track-sort-indicator" />
  );
}

interface SortHeaderButtonProps {
  label: string;
  direction: SortDirection | null;
  onClick: () => void;
  alignRight?: boolean;
}

export function SortHeaderButton({ label, direction, onClick, alignRight = false }: SortHeaderButtonProps) {
  return (
    <button
      className={`playlist-col-header-cell track-sort-btn${alignRight ? " playlist-col-header-cell--right" : ""}`}
      onClick={onClick}
    >
      {label}
      <SortIndicator direction={direction} />
    </button>
  );
}
