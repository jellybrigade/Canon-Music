import Database from "@tauri-apps/plugin-sql";
import { runMigrations } from "./migrations";

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
