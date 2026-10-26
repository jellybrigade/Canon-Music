import { ChevronDown, ChevronUp } from "lucide-react";
import type { SortDirection } from "../lib/trackSort";

export function SortIndicator({ direction }: { direction: SortDirection | null }) {
  if (direction === null) return null;
  return direction === "asc" ? (
    <ChevronUp size={11} style={{ verticalAlign: "middle", marginLeft: 2 }} />
  ) : (
    <ChevronDown size={11} style={{ verticalAlign: "middle", marginLeft: 2 }} />
  );
}
