/**
 * The one LIKE escaper. Pair with `ESCAPE '\\'` (doubled backslash in TS source; a single one
 * decodes to an empty escape, which SQLite rejects).
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
