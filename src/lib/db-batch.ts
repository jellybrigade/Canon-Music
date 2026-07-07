import Database from "@tauri-apps/plugin-sql";

// tauri-plugin-sql's SQLite pool has more than one connection, so a raw
// BEGIN/COMMIT split across two separate execute() calls can land on
// different connections and silently fail to wrap anything. Batch writes
// into fewer, larger multi-row statements instead of relying on transactions.
// Chunk size is derived per call site from SQLite's bound-parameter ceiling
// (32766 as of the bundled libsqlite3-sys, kept below that with headroom)
// divided by the number of "?" placeholders each row needs.
export const SQLITE_MAX_VARIABLES = 32000;

/**
 * Batches `rows` into fewer multi-row INSERT statements. `placeholderRow` is
 * the literal "(?, ...)" (or "(?, 'literal', ?, ...)") group for one row;
 * `paramsPerRow` is how many "?" it actually contains, used to size chunks
 * under SQLite's bound-parameter limit. `buildSql` receives the joined
 * per-chunk placeholder groups and returns the full statement.
 */
export async function executeBatched(
  db: Database,
  rows: unknown[][],
  placeholderRow: string,
  paramsPerRow: number,
  buildSql: (placeholders: string) => string,
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = Math.max(1, Math.floor(SQLITE_MAX_VARIABLES / paramsPerRow));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => placeholderRow).join(", ");
    await db.execute(buildSql(placeholders), chunk.flat());
  }
}
