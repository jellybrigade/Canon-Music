/**
 * The one LIKE escaper. Pair with `ESCAPE '\\'` (doubled backslash in TS source; a single one
 * decodes to an empty escape, which SQLite rejects).
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Rows whose id starts `${serverId}:`, as an index range. `LIKE` is case-insensitive, so it
 * scans the table, and it also matches another server whose id differs only in case.
 */
export function ownedByServer(column: string, serverId: string): { sql: string; params: [string, string] } {
  return { sql: `${column} >= ? AND ${column} < ?`, params: [`${serverId}:`, `${serverId};`] };
}
