import Database from "@tauri-apps/plugin-sql";

// tauri-plugin-sql's pool has no connection affinity, so BEGIN/COMMIT across two
// execute() calls can silently no-op; batch into multi-row statements instead.
export const SQLITE_MAX_VARIABLES = 32000;

/** Batches `rows` into multi-row INSERT statements, chunked under SQLite's bound-parameter limit. */
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
 * One statement per chunk of `ids` under the parameter ceiling. Chunks must be independent:
 * `IN`, never `NOT IN`.
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
