import type Database from "@tauri-apps/plugin-sql";
import { describe, expect, it } from "vitest";
import { executeBatched, executeIdChunks, SQLITE_MAX_VARIABLES } from "./db-batch";
import { createTestDb, type FakeDatabase } from "../test/sqlite";

// db-batch.ts's signature only asks for the execute/select surface the plugin's Database
// provides, which FakeDatabase already implements - the plugin's own class also carries a
// private `path` field FakeDatabase has no reason to fake.
function asDb(db: FakeDatabase): Database {
  return db as unknown as Database;
}

function seedTracks(db: FakeDatabase, ids: string[]): void {
  db.raw.exec("CREATE TABLE tracks (id TEXT PRIMARY KEY)");
  const insert = db.raw.prepare("INSERT INTO tracks (id) VALUES (?)");
  db.raw.transaction((allIds: string[]) => {
    for (const id of allIds) insert.run(id);
  })(ids);
}

describe("executeBatched", () => {
  it("does nothing on an empty row list", async () => {
    const db = createTestDb();
    await executeBatched(asDb(db), [], "(?)", 1, (ph) => `INSERT INTO x VALUES ${ph}`);
    expect(db.executeCount).toBe(0);
  });

  it("chunks rows so each statement calls buildSql with only that chunk's placeholders", async () => {
    const db = createTestDb();
    await db.execute("CREATE TABLE x (a INTEGER, b INTEGER)");
    const rows = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]];
    const calls: string[] = [];
    await executeBatched(asDb(db), rows, "(?, ?)", 2, (ph) => {
      calls.push(ph);
      return `INSERT INTO x VALUES ${ph}`;
    });
    // paramsPerRow=2 -> chunkSize = floor(SQLITE_MAX_VARIABLES/2), far bigger than 5 rows,
    // so this exercises the "no chunking needed" path: one call covering every row.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.split(",").length).toBe(rows.length * 2);
    const stored = await db.select<{ a: number; b: number }[]>("SELECT a, b FROM x ORDER BY a");
    expect(stored).toEqual(rows.map(([a, b]) => ({ a, b })));
  });

  it("splits into exact chunk boundaries when paramsPerRow forces a small chunk size", async () => {
    const db = createTestDb();
    await db.execute("CREATE TABLE x (a INTEGER)");
    // Force chunkSize = 2 by making paramsPerRow = floor(SQLITE_MAX_VARIABLES / 2).
    const paramsPerRow = Math.floor(SQLITE_MAX_VARIABLES / 2);
    const rows = [[1], [2], [3]]; // 3 rows at chunk size 2 -> chunks of [2, 1]
    const chunkSizes: number[] = [];
    await executeBatched(asDb(db), rows, "(?)", paramsPerRow, (ph) => {
      chunkSizes.push(ph.split(",").length);
      return `INSERT INTO x VALUES ${ph}`;
    });
    expect(chunkSizes).toEqual([2, 1]);
  });

  it("floors chunk size at 1 instead of hanging when paramsPerRow exceeds the ceiling", async () => {
    const db = createTestDb();
    await db.execute("CREATE TABLE x (a INTEGER)");
    const rows = [[1], [2]];
    const chunkSizes: number[] = [];
    await executeBatched(asDb(db), rows, "(?)", SQLITE_MAX_VARIABLES + 1000, (ph) => {
      chunkSizes.push(ph.split(",").length);
      return `INSERT INTO x VALUES ${ph}`;
    });
    expect(chunkSizes).toEqual([1, 1]);
  });
});

describe("executeIdChunks", () => {
  it("does nothing on an empty id list", async () => {
    const db = createTestDb();
    await executeIdChunks(asDb(db), [], (ph) => `DELETE FROM tracks WHERE id IN (${ph})`);
    expect(db.executeCount).toBe(0);
  });

  it("chunks a large id list at the SQLITE_MAX_VARIABLES boundary", async () => {
    const db = createTestDb();
    const ids = Array.from({ length: SQLITE_MAX_VARIABLES + 1 }, (_, i) => `id-${i}`);
    seedTracks(db, ids);
    const chunkSizes: number[] = [];
    await executeIdChunks(asDb(db), ids, (ph) => {
      chunkSizes.push(ph.split(",").length);
      return `DELETE FROM tracks WHERE id IN (${ph})`;
    });
    expect(chunkSizes).toEqual([SQLITE_MAX_VARIABLES, 1]);
  });

  it("refuses a NOT IN statement instead of silently deleting rows other chunks meant to keep", async () => {
    // Regression for known-issues.md: "a chunked NOT IN would make every chunk delete the rows
    // the other chunks were keeping." Two ids split across two chunks (small chunk size forced
    // is not available here since SQLITE_MAX_VARIABLES is a fixed export, so this uses a real
    // multi-chunk-sized id list) must not each independently run `NOT IN (their own ids)`,
    // which would delete everything since neither chunk sees the other's ids as "keep".
    const db = createTestDb();
    const keep = ["keep-1", "keep-2"];
    const deleteTarget = Array.from({ length: SQLITE_MAX_VARIABLES + 1 }, (_, i) => `del-${i}`);
    seedTracks(db, [...keep, ...deleteTarget]);

    await expect(
      executeIdChunks(asDb(db), deleteTarget, (ph) => `DELETE FROM tracks WHERE id NOT IN (${ph})`)
    ).rejects.toThrow(/NOT IN/i);
  });

  it("still allows a plain IN statement across multiple chunks", async () => {
    const db = createTestDb();
    const keep = ["keep-1"];
    const deleteTarget = Array.from({ length: SQLITE_MAX_VARIABLES + 1 }, (_, i) => `del-${i}`);
    seedTracks(db, [...keep, ...deleteTarget]);

    await executeIdChunks(asDb(db), deleteTarget, (ph) => `DELETE FROM tracks WHERE id IN (${ph})`);

    const remaining = await db.select<{ id: string }[]>("SELECT id FROM tracks");
    expect(remaining.map((r) => r.id)).toEqual(keep);
  });
});
