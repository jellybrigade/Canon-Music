// Guard for known-issues.md: a hand-kept list of "which tables hold a track id" goes stale the
// moment a migration adds the twelfth one, and the failure is silent - the prune leaves rows the
// grid still renders, and a remap carries every table but the one nobody remembered. So the list
// lives in one place and this file sweeps the schema for anything it missed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TRACK_ID_TABLES, prunedTrackIdTables, purgedTrackIdTables, remappedTrackIdTables } from "./trackIdTables";

const MIGRATIONS = readFileSync(fileURLToPath(new URL("./migrations.ts", import.meta.url)), "utf-8");
const LIBRARY_WRITE = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/library_write.rs", import.meta.url)),
  "utf-8"
);

/**
 * Every `CREATE TABLE` in the schema that declares a column whose name ends in `track_id`.
 * A table the same file later renames away or drops is scratch space for a column rebuild, so it
 * never reaches a running install and nothing can be keyed to it.
 */
function schemaTrackIdColumns(): Map<string, string> {
  const found = new Map<string, string>();
  const scratch = new Set(
    [...MIGRATIONS.matchAll(/ALTER TABLE (\w+) RENAME TO|DROP TABLE(?: IF EXISTS)? (\w+)/g)].flatMap(
      (match) => [match[1], match[2]].filter((name): name is string => name !== undefined)
    )
  );
  const create = /CREATE TABLE(?: IF NOT EXISTS)? (\w+) \(([^;]*?)\)\s*;/g;
  for (const match of MIGRATIONS.matchAll(create)) {
    const [, table, body] = match;
    if (table === undefined || body === undefined) continue;
    if (scratch.has(table)) continue;
    for (const column of body.matchAll(/^\s*(\w*track_id)\s+\w/gm)) {
      const name = column[1];
      if (name !== undefined) found.set(table, name);
    }
  }
  return found;
}

describe("track id table registry", () => {
  it("sees the schema tables it is meant to sweep", () => {
    const columns = schemaTrackIdColumns();
    expect(columns.get("loved_tracks")).toBe("track_id");
    expect(columns.get("playlist_resume")).toBe("last_track_id");
    expect(columns.size).toBeGreaterThan(8);
  });

  it("lists every schema table holding a track id", () => {
    const listed = new Set(TRACK_ID_TABLES.map((entry) => entry.table));
    const missing = [...schemaTrackIdColumns().keys()].filter((table) => !listed.has(table));
    expect(missing).toEqual([]);
  });

  it("names each table's own track id column", () => {
    for (const [table, column] of schemaTrackIdColumns()) {
      expect(TRACK_ID_TABLES.find((entry) => entry.table === table)?.column).toBe(column);
    }
  });

  it("covers the search index, which names its track id column `id`", () => {
    expect(TRACK_ID_TABLES.find((entry) => entry.table === "tracks_fts")?.column).toBe("id");
  });

  it("purges everything it prunes, since a removed server keeps nothing a vanished track kept", () => {
    const purged = new Set(purgedTrackIdTables().map((entry) => entry.table));
    for (const entry of prunedTrackIdTables()) expect(purged.has(entry.table)).toBe(true);
  });

  it("carries every table a live read path can reach across an id rewrite", () => {
    const remapped = new Set(remappedTrackIdTables().map((entry) => entry.table));
    for (const entry of TRACK_ID_TABLES) {
      // tracks_fts is the one exception: rebuilt from `tracks` for every album the sync touched.
      if (entry.inert || entry.table === "tracks_fts") expect(remapped.has(entry.table)).toBe(false);
      else expect(remapped.has(entry.table)).toBe(true);
    }
  });

  it("agrees with the Rust list the remap writes through", () => {
    // The remap runs in one transaction, so it lives in Rust and keeps its own copy of the
    // list. A table added here and forgotten there is a table the remap silently drops.
    const block = LIBRARY_WRITE.match(/REMAPPED_TRACK_ID_TABLES: &\[\(&str, &str\)\] = &\[([^\]]*)\]/);
    expect(block).not.toBeNull();
    const rust = [...(block?.[1] ?? "").matchAll(/\("(\w+)", "(\w+)"\)/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(rust).toEqual(remappedTrackIdTables().map((entry) => `${entry.table}.${entry.column}`));
  });

  it("lists dependants before the tracks row they are keyed to", () => {
    expect(TRACK_ID_TABLES.some((entry) => entry.table === "tracks")).toBe(false);
  });
});
