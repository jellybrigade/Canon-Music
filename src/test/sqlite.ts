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
import { migrations } from "../db/migrations";

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
    async execute(query, bindValues = []) {
      db.executeCount++;
      const params = bindValues.map(toBindable);
      const trimmed = query.trim();
      // PRAGMA and other statements that return rows cannot go through `.run()`.
      if (/^pragma\b/i.test(trimmed)) {
        raw.prepare(trimmed).all(...(params as never[]));
        return { rowsAffected: 0 };
      }
      const info = raw.prepare(trimmed).run(...(params as never[]));
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
    async select<T>(query: string, bindValues: unknown[] = []) {
      const params = bindValues.map(toBindable);
      return raw.prepare(query.trim()).all(...(params as never[])) as T;
    },
    async close() {
      raw.close();
      return true;
    },
  };

  return db;
}

/**
 * Applies `src/db/migrations.ts` the same way `src/db/index.ts` does, including the
 * split-on-";" behavior, since a migration that only works as one blob would pass here and
 * fail in the app.
 */
export async function migrateTestDb(db: FakeDatabase): Promise<void> {
  await db.execute("PRAGMA journal_mode=WAL");
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`);

  const rows = await db.select<{ version: number }[]>(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
  );
  const current = rows[0]?.version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const statements = migration.sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      try {
        await db.execute(statement);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes("duplicate column name")) throw e;
      }
    }
    await db.execute("INSERT INTO schema_migrations (version) VALUES (?)", [migration.version]);
  }
}

export async function createMigratedTestDb(): Promise<FakeDatabase> {
  const db = createTestDb();
  await migrateTestDb(db);
  db.executeCount = 0;
  return db;
}
