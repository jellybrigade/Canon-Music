import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import canonTreeData from "../../../assets/canon-tree.json";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { invokeArgs, invokeCount } from "../../../test/perf";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../../../db", () => ({ getDb: async () => holder.db }));

const { carryGenreTree, planGenreRenames } = await import("./genreTreeCarry");
const { getCanonTree } = await import("./canonicalize");

function asDb(db: FakeDatabase): Database {
  return db as unknown as Database;
}

function testDb(): FakeDatabase {
  if (!holder.db) throw new Error("test db not created");
  return holder.db;
}

beforeEach(async () => {
  resetTauriMocks();
  holder.db = await createMigratedTestDb();
  onInvoke("carry_genre_renames", () => undefined);
});

describe("bundled tree renames", () => {
  const ids = new Set(canonTreeData.nodes.map((n) => n.id));

  it("rename only ids the tree dropped, onto ids the tree has", () => {
    expect(canonTreeData.renames.length).toBeGreaterThan(0);
    for (const { from, to } of canonTreeData.renames) {
      expect(ids.has(from), from).toBe(false);
      expect(ids.has(to), to).toBe(true);
    }
  });
});

describe("planGenreRenames", () => {
  it("names each rename's new node and seeds only old names whose key no longer resolves there", async () => {
    const tree = await getCanonTree();
    const plan = planGenreRenames(
      [
        { from: "pyschedelic", fromName: "Pyschedelic", to: "psychedelic" },
        { from: "punk", fromName: "Punk", to: "punk-post-punk-hardcore" },
      ],
      tree
    );
    expect(plan).toEqual([
      { from: "pyschedelic", to: "psychedelic", toName: "Psychedelic", seed: null },
      {
        from: "punk",
        to: "punk-post-punk-hardcore",
        toName: "Punk / Post-Punk / Hardcore",
        seed: { rawValue: "Punk", kind: "genre", normValue: "punk" },
      },
    ]);
  });

  it("refuses a rename onto a node the tree does not have", async () => {
    const tree = await getCanonTree();
    expect(() => planGenreRenames([{ from: "a", fromName: "A", to: "no-such-node" }], tree)).toThrow(
      /no-such-node/
    );
  });
});

describe("carryGenreTree", () => {
  it("carries the bundled renames once, when the stored tree version differs", async () => {
    await carryGenreTree(asDb(testDb()));
    expect(invokeCount("carry_genre_renames")).toBe(1);
    const [args] = invokeArgs("carry_genre_renames") as [{ renames: { from: string }[]; treeVersion: string }];
    expect(args.treeVersion).toBe(canonTreeData.version);
    expect(args.renames.map((r) => r.from)).toEqual(canonTreeData.renames.map((r) => r.from));
  });

  it("reads one row and carries nothing when the stored version matches", async () => {
    const db = testDb();
    await db.execute("INSERT INTO settings (key, value) VALUES ('genre_tree_version', ?)", [canonTreeData.version]);
    db.selectCount = 0;
    db.executeCount = 0;
    await carryGenreTree(asDb(db));
    expect(invokeCount("carry_genre_renames")).toBe(0);
    expect(db.selectCount).toBe(1);
    expect(db.executeCount).toBe(0);
  });
});
