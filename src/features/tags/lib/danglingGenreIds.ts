import { invoke } from "@tauri-apps/api/core";
import type Database from "@tauri-apps/plugin-sql";
import { GENRE_ID_HOLDERS, type GenreIdHolder } from "../../../db/genreIdTables";
import { ACCEPTED, IGNORED } from "../hooks/useTagMappings";

export type DanglingGenreId = {
  id: string;
  /** A display name stored beside the id somewhere, else null. */
  name: string | null;
  uses: { table: string; count: number }[];
};

type HolderCount = { id: string; count: number; name: string | null };

function isGenreSentinel(id: string): boolean {
  return id === ACCEPTED || id === IGNORED || id.startsWith("raw:");
}

async function countIdColumn(db: Database, holder: GenreIdHolder): Promise<HolderCount[]> {
  const name = holder.nameColumn === null ? "NULL" : `MIN(${holder.nameColumn})`;
  return db.select<HolderCount[]>(
    `SELECT ${holder.column} AS id, COUNT(*) AS count, ${name} AS name
     FROM ${holder.table} WHERE ${holder.column} IS NOT NULL
     GROUP BY ${holder.column}`
  );
}

async function countJsonColumn(db: Database, holder: GenreIdHolder): Promise<HolderCount[]> {
  const rows = await db.select<{ value: string }[]>(
    `SELECT ${holder.column} AS value FROM ${holder.table}
     WHERE ${holder.column} IS NOT NULL AND json_valid(${holder.column})`
  );
  const field = holder.jsonPath === "$.selectedGenres" ? "selectedGenres" : null;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const parsed: unknown = JSON.parse(row.value);
    const list: unknown =
      field === null ? parsed : typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, field) : null;
    if (!Array.isArray(list)) continue;
    for (const id of new Set(list.filter((item): item is string => typeof item === "string"))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts].map(([id, count]) => ({ id, count, name: null }));
}

/**
 * Every stored genre id that is neither a tree node nor a sentinel, with where it is held. A
 * true RYM removal or a missed rename entry lands here instead of vanishing from its albums.
 */
export async function findDanglingGenreIds(
  db: Database,
  liveIds: ReadonlySet<string>
): Promise<DanglingGenreId[]> {
  const byId = new Map<string, DanglingGenreId>();
  for (const holder of GENRE_ID_HOLDERS) {
    const counts = holder.jsonPath === null ? await countIdColumn(db, holder) : await countJsonColumn(db, holder);
    for (const { id, count, name } of counts) {
      if (liveIds.has(id) || isGenreSentinel(id)) continue;
      let entry = byId.get(id);
      if (!entry) {
        entry = { id, name: null, uses: [] };
        byId.set(id, entry);
      }
      entry.name ??= name;
      entry.uses.push({ table: holder.table, count });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Moves every reference onto `to`, or removes them all when `to` is null. One transaction. */
export async function repairDanglingGenreId(
  from: string,
  to: { id: string; name: string } | null
): Promise<void> {
  await invoke("repair_dangling_genre_id", { from, to });
}
