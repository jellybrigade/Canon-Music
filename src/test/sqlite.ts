/**
 * In-memory better-sqlite3 behind tauri-plugin-sql's `execute`/`select` surface. Differs from
 * the plugin: synchronous underneath (no async interleavings), and rejects with `Error`, not string.
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
   * Every statement seen, in order, tagged by kind - waste assertions usually want a
   * count of one query *shape*, which a bare total can't distinguish.
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
  return wrapRaw(new BetterSqlite3(":memory:"));
}

/**
 * A second in-memory database holding a byte copy of `db`'s current contents. Lets a test reach
 * an expensive intermediate state once and branch off it, instead of rebuilding it per case.
 */
export function forkTestDb(db: FakeDatabase): FakeDatabase {
  return wrapRaw(new BetterSqlite3(db.raw.serialize()));
}

function wrapRaw(raw: BetterSqlite3.Database): FakeDatabase {
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
 * Runs the real `runMigrations` on purpose: a harness-owned copy of the runner
 * previously went stale while the suite stayed green.
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
