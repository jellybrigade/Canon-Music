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

/**
 * Runs one statement per chunk of `ids`, each chunk sized under the same
 * bound-parameter ceiling. `buildSql` receives the comma-joined "?" list for the
 * chunk, e.g. ``(ph) => `DELETE FROM tracks WHERE id IN (${ph})` ``.
 *
 * Only safe for statements whose chunks are independent, which means IN and not
 * NOT IN: chunking a NOT IN would make every chunk delete the rows the other
 * chunks were keeping.
 */
export async function executeIdChunks(
  db: Database,
  ids: readonly string[],
  buildSql: (placeholders: string) => string,
): Promise<void> {
  if (ids.length === 0) return;
  let first = true;
  for (let start = 0; start < ids.length; start += SQLITE_MAX_VARIABLES) {
    const chunk = ids.slice(start, start + SQLITE_MAX_VARIABLES);
    const placeholders = chunk.map(() => "?").join(", ");
    const sql = buildSql(placeholders);
    if (first) {
      if (/\bnot\s+in\b/i.test(sql)) {
        throw new Error("executeIdChunks does not support NOT IN: chunking would make each chunk delete rows the other chunks meant to keep");
      }
      first = false;
    }
    await db.execute(sql, chunk);
  }
}
