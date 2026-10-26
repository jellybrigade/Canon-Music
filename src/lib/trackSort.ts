export type SortDirection = "asc" | "desc";
export type SortValue = string | number | null;

// One reused collator instead of String.prototype.localeCompare, which constructs a fresh
// collator on every call. The sort runs over the whole library, so on a large one that is
// hundreds of thousands of constructions per sort change.
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

// Missing values sort last in both directions.
export function sortRows<T>(rows: readonly T[], valueFor: (row: T) => SortValue, direction: SortDirection): T[] {
  return [...rows].sort((rowA, rowB) => {
    const a = valueFor(rowA);
    const b = valueFor(rowB);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const comparison = compareValues(a, b);
    return direction === "asc" ? comparison : -comparison;
  });
}
