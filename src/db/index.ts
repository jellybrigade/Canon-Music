import Database from "@tauri-apps/plugin-sql";
import { migrations } from "./migrations";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:canon.db").then(async (database) => {
      await runMigrations(database);
      return database;
    });
  }
  return dbPromise;
}

async function runMigrations(database: Database): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    )
  `);

  type Row = { version: number };
  const rows = await database.select<Row[]>(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
  );
  const current = rows[0]?.version ?? 0;

  for (const migration of migrations) {
    if (migration.version > current) {
      await database.execute(migration.sql);
      await database.execute(
        "INSERT INTO schema_migrations (version) VALUES (?)",
        [migration.version]
      );
    }
  }
}
