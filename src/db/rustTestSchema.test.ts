// The Rust tests build their tables by hand, since rusqlite never runs `migrations.ts`. A column a
// migration renames or drops keeps passing there while the shipped query fails with "no such
// column", so every hand-built table and column must exist in the migrated schema.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createMigratedTestDb } from "../test/sqlite";

const RUST_SOURCE_DIR = fileURLToPath(new URL("../../src-tauri/src", import.meta.url));

interface FixtureTable {
  file: string;
  table: string;
  statement: string;
}

/** Every `CREATE TABLE` statement in `source`, cut at its balanced closing parenthesis. */
function extractCreateTables(source: string): { table: string; statement: string }[] {
  const found: { table: string; statement: string }[] = [];
  for (const match of source.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)\s*\(/g)) {
    const table = match[1];
    if (table === undefined) continue;
    const start = match.index;
    let depth = 0;
    let end = -1;
    for (let i = start + match[0].length - 1; i < source.length; i++) {
      if (source[i] === "(") depth++;
      if (source[i] === ")") depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end === -1) throw new Error(`Unbalanced CREATE TABLE ${table}`);
    found.push({ table, statement: source.slice(start, end) });
  }
  return found;
}

function rustFixtureTables(): FixtureTable[] {
  const files = readdirSync(RUST_SOURCE_DIR, { recursive: true, encoding: "utf-8" }).filter((path) =>
    path.endsWith(".rs"),
  );
  return files.flatMap((file) =>
    extractCreateTables(readFileSync(join(RUST_SOURCE_DIR, file), "utf-8")).map((created) => ({ file, ...created })),
  );
}

function columnsOf(database: BetterSqlite3.Database, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((row) => row.name);
}

/** `"file table.column"` for each hand-built column the migrated schema lacks. */
function driftAgainst(real: BetterSqlite3.Database, fixtures: FixtureTable[]): string[] {
  const drift: string[] = [];
  for (const { file, table, statement } of fixtures) {
    const realColumns = columnsOf(real, table);
    if (realColumns.length === 0) {
      drift.push(`${file} ${table} (no such table)`);
      continue;
    }
    const scratch = new BetterSqlite3(":memory:");
    scratch.exec(statement);
    for (const column of columnsOf(scratch, table)) {
      if (!realColumns.includes(column)) drift.push(`${file} ${table}.${column}`);
    }
    scratch.close();
  }
  return drift;
}

describe("Rust test schemas", () => {
  it("finds the hand-built tables in every Rust test module", () => {
    const fixtures = rustFixtureTables();
    const files = new Set(fixtures.map((fixture) => fixture.file));
    expect(files).toContain(join("library_read", "mod.rs"));
    expect(files).toContain(join("library_write", "track_remap.rs"));
    expect(fixtures.length).toBeGreaterThan(30);
  });

  it("declares only tables and columns the migrations create", async () => {
    const db = await createMigratedTestDb();
    expect(driftAgainst(db.raw, rustFixtureTables())).toEqual([]);
  });

  it("reports a column the migrations renamed away", async () => {
    const db = await createMigratedTestDb();
    const stale = extractCreateTables("CREATE TABLE albums (id TEXT PRIMARY KEY, album_title TEXT);").map(
      (created) => ({ file: "stale.rs", ...created }),
    );
    expect(driftAgainst(db.raw, stale)).toEqual(["stale.rs albums.album_title"]);
  });

  it("reports a table the migrations never create", async () => {
    const db = await createMigratedTestDb();
    const stale = extractCreateTables("CREATE TABLE ghosts (id TEXT);").map((created) => ({
      file: "stale.rs",
      ...created,
    }));
    expect(driftAgainst(db.raw, stale)).toEqual(["stale.rs ghosts (no such table)"]);
  });
});
