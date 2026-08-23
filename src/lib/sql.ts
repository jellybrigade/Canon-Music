/**
 * LIKE treats `%` and `_` as wildcards, so any value interpolated into a pattern has to be
 * escaped and the statement has to carry an ESCAPE clause. Held here rather than per-file
 * because two private copies had already diverged in spelling, and a divergent escaper is
 * invisible to the sweep in `sql-escaping.test.ts` - that test can see a missing clause, not a
 * wrong escaper.
 *
 * Spell the clause with a doubled backslash in TS source. The single-backslash spelling decodes
 * to an empty escape character, which SQLite rejects at prepare time (see known-issues.md).
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
