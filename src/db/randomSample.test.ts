import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { selectRandomSample } from "./randomSample";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
  for (let i = 0; i < 10; i++) {
    db.raw.prepare("INSERT INTO loved_tracks (track_id) VALUES (?)").run(`s:${String(i).padStart(2, "0")}`);
  }
  db.raw.prepare("INSERT INTO loved_tracks (track_id) VALUES ('other:01')").run();
  db.queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sample(limit: number): Promise<{ track_id: string }[]> {
  return selectRandomSample<{ track_id: string }>(db as never, {
    columns: "track_id",
    from: "loved_tracks",
    where: "track_id LIKE 's:%'",
    params: [],
    orderBy: "track_id",
    limit,
  });
}

describe("selectRandomSample", () => {
  it("returns every matching row when the pool fits the limit", async () => {
    const rows = await sample(50);
    expect(rows.map((r) => r.track_id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `s:${String(i).padStart(2, "0")}`),
    );
  });

  it("takes a window from a random offset and wraps past the end", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.95);
    const rows = await sample(4);
    expect(rows.map((r) => r.track_id).sort()).toEqual(["s:00", "s:01", "s:02", "s:09"]);
  });

  it("reaches the first rows when the offset lands at the start", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const rows = await sample(3);
    expect(rows.map((r) => r.track_id).sort()).toEqual(["s:00", "s:01", "s:02"]);
  });

  it("returns nothing for an empty pool", async () => {
    const rows = await selectRandomSample(db as never, {
      columns: "track_id",
      from: "loved_tracks",
      where: "track_id = ?",
      params: ["missing"],
      orderBy: "track_id",
      limit: 5,
    });
    expect(rows).toEqual([]);
  });

  it("never sorts the pool at random", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await sample(4);
    expect(db.queryLog.filter((q) => /RANDOM\(\)/i.test(q.sql))).toEqual([]);
    expect(db.selectCount).toBeLessThanOrEqual(3);
  });
});
