import { invoke } from "@tauri-apps/api/core";
import type { QueryClient } from "@tanstack/react-query";
import type Database from "@tauri-apps/plugin-sql";
import canonTreeData from "../../../assets/canon-tree.json";
import { QK } from "../../../lib/queryKeys";
import { bustCanonTreeCache, findCanonicalSync, getCanonTree, sqlNorm, type CanonTree, type TagKind } from "./canonicalize";
import { invalidateManualMappings } from "./manualMappings";

export type TreeRename = { from: string; fromName: string; to: string };

export type GenreIdRename = {
  from: string;
  to: string;
  toName: string;
  seed: { rawValue: string; kind: TagKind; normValue: string } | null;
};

/**
 * The seed maps the old name by hand onto its successor, and only where the tag would no longer
 * land there on its own (exactly or fuzzily), so a server still tagging "Punk" keeps its genre.
 */
export function planGenreRenames(renames: readonly TreeRename[], tree: CanonTree): GenreIdRename[] {
  return renames.map(({ from, fromName, to }) => {
    const node = tree.byId.get(to);
    if (!node) throw new Error(`genre rename "${from}" points at "${to}", which is not in the tree`);
    const kind: TagKind = node.type === "mood" ? "mood" : "genre";
    const resolves = findCanonicalSync(fromName, kind, tree).node?.id === to;
    return {
      from,
      to,
      toName: node.name,
      seed: resolves ? null : { rawValue: fromName, kind, normValue: sqlNorm(fromName) },
    };
  });
}

/** Drops every cached read of stored genre ids after they moved in the database. */
export function refreshGenreIdReads(queryClient: QueryClient): void {
  invalidateManualMappings();
  // User nodes' parent ids may have moved under the cached tree.
  bustCanonTreeCache();
  for (const queryKey of [
    QK.tagVocab(),
    QK.tagMappings(),
    QK.trackTagsAll(),
    QK.genreDisplayMappings(),
    QK.normalizedTagsAll(),
    QK.userTreeNodes(),
    QK.danglingGenreIds(),
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** Carries stored genre ids onto a new bundled tree, once per tree version. */
export async function carryGenreTree(db: Database, queryClient: QueryClient): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'genre_tree_version'"
  );
  if (rows[0]?.value === canonTreeData.version) return;
  const renames = planGenreRenames(canonTreeData.renames, await getCanonTree());
  await invoke("carry_genre_renames", { renames, treeVersion: canonTreeData.version });
  // Runs beside first render, so Tags may already hold the old ids.
  refreshGenreIdReads(queryClient);
}
