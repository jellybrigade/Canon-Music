/**
 * In-memory SQLite harness presenting the same `execute` / `select` surface as
 * tauri-plugin-sql's `Database`, backed by better-sqlite3.
 *
 * This is what makes `src/lib/sync.ts`, `smartPlaylist.ts`, `db-batch.ts` and the query hooks
 * testable at all: they only ever touch `getDb()`, so a test can hand them this object and
 * assert against real SQL against the real schema, rather than mocking the queries away and
 * proving nothing.
 *
 * Deliberate differences from the plugin, both of which matter when reading a failure:
 * - `execute` here is synchronous underneath, so an interleaving bug that only shows up across
 *   the async SQL bridge will not reproduce.
 * - the plugin rejects with a plain string, not an `Error`. `migrations.ts` handles both shapes,
 *   so tests here exercise the `Error` branch.
 */
import BetterSqlite3 from "better-sqlite3";
import { runMigrations } from "../db/migrations";

export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/** The subset of tauri-plugin-sql's `Database` that `src/` actually calls. */
export interface FakeDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  close(): Promise<boolean>;
  /** Escape hatch for assertions that would be awkward through the async surface. */
  raw: BetterSqlite3.Database;
  /** Count of `execute` calls, for "an idempotent sync writes nothing" assertions. */
  executeCount: number;
  /** Count of `select` calls, for "this pass reads the library once" assertions. */
  selectCount: number;
  /**
   * Every statement seen, in order, tagged by kind. Waste assertions usually want a count
   * of one *shape* of query rather than of all SQL, and a total alone cannot tell a second
   * read of the same table from a different read that had to happen.
   */
  queryLog: { kind: "execute" | "select"; sql: string }[];
}

function toBindable(value: unknown): unknown {
  // better-sqlite3 refuses booleans and undefined; the plugin coerces both.
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

export function createTestDb(): FakeDatabase {
  const raw = new BetterSqlite3(":memory:");
  raw.pragma("foreign_keys = ON");

  const db: FakeDatabase = {
    raw,
    executeCount: 0,
    selectCount: 0,
    queryLog: [],
    async execute(query, bindValues = []) {
      db.executeCount++;
      const params = bindValues.map(toBindable);
      const trimmed = query.trim();
      db.queryLog.push({ kind: "execute", sql: trimmed });
      // PRAGMA and other statements that return rows cannot go through `.run()`.
      if (/^pragma\b/i.test(trimmed)) {
        raw.prepare(trimmed).all(...(params as never[]));
        return { rowsAffected: 0 };
      }
      const info = raw.prepare(trimmed).run(...(params as never[]));
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
    async select<T>(query: string, bindValues: unknown[] = []) {
      db.selectCount++;
      const params = bindValues.map(toBindable);
      const trimmed = query.trim();
      db.queryLog.push({ kind: "select", sql: trimmed });
      return raw.prepare(trimmed).all(...(params as never[])) as T;
    },
    async close() {
      raw.close();
      return true;
    },
  };

  return db;
}

/**
 * Runs the real `runMigrations` from `src/db/migrations.ts` against the harness db. This calls
 * production code on purpose: the harness used to carry its own copy of the runner, so a fix to
 * one copy left the other stale and the suite green either way.
 */
export async function migrateTestDb(db: FakeDatabase): Promise<void> {
  await runMigrations(db);
}

export async function createMigratedTestDb(): Promise<FakeDatabase> {
  const db = createTestDb();
  await migrateTestDb(db);
  db.executeCount = 0;
  db.selectCount = 0;
  db.queryLog.length = 0;
  return db;
}
