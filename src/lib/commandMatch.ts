const PREFIX = 0;
const WORD_START = 1;
const INSIDE = 2;

function matchRank(label: string, query: string): number | null {
  const lower = label.toLowerCase();
  if (lower.startsWith(query)) return PREFIX;
  const at = lower.indexOf(query);
  if (at === -1) return null;
  const words = lower.split(/[^a-z0-9]+/);
  return words.some((word) => word.startsWith(query)) ? WORD_START : INSIDE;
}

/** The commands whose label holds the query, label starts first, then word starts, then the rest. */
export function rankCommands<T extends { label: string }>(commands: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return commands
    .map((command) => ({ command, rank: matchRank(command.label, needle) }))
    .filter((entry): entry is { command: T; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.command);
}
