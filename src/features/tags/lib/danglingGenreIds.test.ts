import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import canonTreeData from "../../../assets/canon-tree.json";
import { GENRE_ID_HOLDERS } from "../../../db/genreIdTables";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { invokeArgs, invokeCount } from "../../../test/perf";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);

const { findDanglingGenreIds, repairDanglingGenreId } = await import("./danglingGenreIds");

let db: FakeDatabase;
// Migrations seed mappings onto bundled nodes, so the live set is the real tree.
const LIVE = new Set([...canonTreeData.nodes.map((node) => node.id), "user:skate"]);

function asDb(fake: FakeDatabase): Database {
  return fake as unknown as Database;
}

async function seedEveryHolder(id: string): Promise<void> {
  await db.execute(
    "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, norm_value) VALUES (?, 'genre', ?, 'manual', ?)",
    [`raw ${id}`, id, `raw ${id}`]
  );
  await db.execute(
    "INSERT INTO track_tags (track_id, kind, raw_value, canonical_id, source) VALUES ('t1', 'genre', ?, ?, 'server')",
    [`raw ${id}`, id]
  );
  await db.execute("INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES ('a1', ?, 'direct', 'Old Name')", [id]);
  await db.execute("INSERT INTO album_user_genres (album_id, canonical_id, name) VALUES ('a2', ?, 'Old Name')", [id]);
  await db.execute("INSERT INTO album_genre_exclusions (album_id, canonical_id) VALUES ('a3', ?)", [id]);
  await db.execute(
    "INSERT INTO user_tree_nodes (id, name, type, canonical_key, parent_ids) VALUES (?, 'Child', 'genre', ?, ?)",
    [`user:child-${id}`, `child ${id}`, JSON.stringify([id])]
  );
  await db.execute("INSERT INTO playlists (id, server_id, name, rules_json) VALUES (?, 'srv', 'Smart', ?)", [
    `p-${id}`,
    JSON.stringify({ name: id, selectedGenres: [id] }),
  ]);
}

beforeEach(async () => {
  resetTauriMocks();
  db = await createMigratedTestDb();
  await db.execute("INSERT INTO servers (id, type, url, display_name, username) VALUES ('srv', 'navidrome', 'http://nd', 'Home', 'u')");
});

describe("findDanglingGenreIds", () => {
  it("reports an id no node carries in every holder that stores it", async () => {
    await seedEveryHolder("gone");
    const found = await findDanglingGenreIds(asDb(db), LIVE);
    expect(found).toEqual([
      {
        id: "gone",
        name: "Old Name",
        uses: GENRE_ID_HOLDERS.map((holder) => ({ table: holder.table, count: 1 })),
      },
    ]);
  });

  it("passes over live ids, decisions and unmatched raw tags", async () => {
    await seedEveryHolder("rock");
    await seedEveryHolder("user:skate");
    await db.execute(
      "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, norm_value) VALUES ('Ok', 'genre', '__accepted__', 'manual', 'ok'), ('No', 'genre', '__ignored__', 'manual', 'no')"
    );
    await db.execute("INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES ('a9', 'raw:outrun', 'direct', 'Outrun')");
    await db.execute("INSERT INTO playlists (id, server_id, name, rules_json) VALUES ('p-bad', 'srv', 'Broken', 'not json')");
    await db.execute("INSERT INTO playlists (id, server_id, name, rules_json) VALUES ('p-plain', 'srv', 'Plain', '{\"name\":\"x\"}')");

    expect(await findDanglingGenreIds(asDb(db), LIVE)).toEqual([]);
  });

  it("counts each holder's references and names ids without a stored name by id", async () => {
    await seedEveryHolder("gone");
    await db.execute(
      "INSERT INTO track_tags (track_id, kind, raw_value, canonical_id, source) VALUES ('t2', 'genre', 'x', 'gone', 'server'), ('t3', 'genre', 'y', 'also-gone', 'server')"
    );
    const found = await findDanglingGenreIds(asDb(db), LIVE);
    expect(found.map((d) => [d.id, d.name])).toEqual([
      ["also-gone", null],
      ["gone", "Old Name"],
    ]);
    expect(found[1]?.uses.find((use) => use.table === "track_tags")?.count).toBe(2);
  });

  it("reads each holder once", async () => {
    await seedEveryHolder("gone");
    db.selectCount = 0;
    await findDanglingGenreIds(asDb(db), LIVE);
    expect(db.selectCount).toBe(GENRE_ID_HOLDERS.length);
  });
});

describe("repairDanglingGenreId", () => {
  it("sends the chosen target, or none to remove", async () => {
    onInvoke("repair_dangling_genre_id", () => undefined);
    await repairDanglingGenreId("gone", { id: "rock", name: "Rock" });
    await repairDanglingGenreId("gone", null);
    expect(invokeCount("repair_dangling_genre_id")).toBe(2);
    expect(invokeArgs("repair_dangling_genre_id")).toEqual([
      { from: "gone", to: { id: "rock", name: "Rock" } },
      { from: "gone", to: null },
    ]);
  });
});
