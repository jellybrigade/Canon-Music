/** Newest first; a tie in time goes by kind, then by key, so the order never depends on read order. */
export function sortNewestFirst<Kind extends string, Item extends { kind: Kind; key: string }>(
  items: Item[],
  timeOf: (item: Item) => number,
  kindOrder: Record<Kind, number>,
): Item[] {
  return items.sort(
    (a, b) =>
      timeOf(b) - timeOf(a) || kindOrder[a.kind] - kindOrder[b.kind] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}
