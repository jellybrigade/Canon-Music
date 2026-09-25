// Guard for known-issues.md: a hand-kept list of "which tables hold a genre tree id" goes stale
// the moment a migration adds one more, and the failure is silent - a renamed id is carried
// everywhere but there, and the user's choice falls out of the tree without a word.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GENRE_ID_HOLDERS } from "./genreIdTables";

const MIGRATIONS = readFileSync(fileURLToPath(new URL("./migrations.ts", import.meta.url)), "utf-8");
const GENRE_CARRY_RS = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/library_write/genre_carry.rs", import.meta.url)),
  "utf-8"
);

/** Every live `table.column` in the schema holding a tree id: `canonical_id` or a `parent_ids` list. */
function schemaGenreIdColumns(): Set<string> {
  const found = new Set<string>();
  const scratch = new Set(
    [...MIGRATIONS.matchAll(/ALTER TABLE (\w+) RENAME TO|DROP TABLE(?: IF EXISTS)? (\w+)/g)].flatMap(
      (match) => [match[1], match[2]].filter((name): name is string => name !== undefined)
    )
  );
  for (const match of MIGRATIONS.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+) \(([^;]*?)\)\s*;/g)) {
    const [, table, body] = match;
    if (table === undefined || body === undefined || scratch.has(table)) continue;
    for (const column of body.matchAll(/^\s*(canonical_id|parent_ids)\s+\w/gm)) found.add(`${table}.${column[1]}`);
  }
  for (const match of MIGRATIONS.matchAll(/ALTER TABLE (\w+) ADD COLUMN (canonical_id|parent_ids)\b/g)) {
    found.add(`${match[1]}.${match[2]}`);
  }
  return found;
}

function listed(): Set<string> {
  return new Set(GENRE_ID_HOLDERS.map((holder) => `${holder.table}.${holder.column}`));
}

function rustTuples(constant: string): string[] {
  const block = GENRE_CARRY_RS.match(new RegExp(`${constant}: &\\[[^=]*=\\s*&\\[([^\\]]*)\\]`));
  expect(block, constant).not.toBeNull();
  return [...(block?.[1] ?? "").matchAll(/\(([^)]*)\)/g)].map((m) =>
    [...(m[1] ?? "").matchAll(/"([^"]*)"/g)].map((s) => s[1]).join(".")
  );
}

describe("genre id table registry", () => {
  it("sees the schema tables it is meant to sweep", () => {
    const columns = schemaGenreIdColumns();
    expect(columns.has("album_genres.canonical_id")).toBe(true);
    expect(columns.has("user_tree_nodes.parent_ids")).toBe(true);
  });

  it("lists every schema column holding a tree id", () => {
    const missing = [...schemaGenreIdColumns()].filter((column) => !listed().has(column));
    expect(missing).toEqual([]);
  });

  it("carries the genres a smart playlist filters on", () => {
    expect(GENRE_ID_HOLDERS.find((holder) => holder.table === "playlists")).toEqual({
      table: "playlists",
      column: "rules_json",
      jsonPath: "$.selectedGenres",
      nameColumn: null,
    });
  });

  it("agrees with the Rust lists the carry writes through", () => {
    // The carry runs in one transaction, so it lives in Rust and keeps its own copy.
    expect(rustTuples("GENRE_ID_COLUMNS")).toEqual(
      GENRE_ID_HOLDERS.filter((h) => h.jsonPath === null).map((h) => `${h.table}.${h.column}`)
    );
    expect(rustTuples("GENRE_NAME_COLUMNS")).toEqual(
      GENRE_ID_HOLDERS.flatMap((h) => (h.nameColumn === null ? [] : [`${h.table}.${h.nameColumn}`]))
    );
    expect(rustTuples("GENRE_ID_JSON_COLUMNS")).toEqual(
      GENRE_ID_HOLDERS.flatMap((h) => (h.jsonPath === null ? [] : [`${h.table}.${h.column}.${h.jsonPath}`]))
    );
  });
});
