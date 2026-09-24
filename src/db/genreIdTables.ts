export type GenreIdHolder = {
  table: string;
  column: string;
  /** Where the ids sit inside a JSON column: `$` for a bare array. Null for a plain id column. */
  jsonPath: "$" | "$.selectedGenres" | null;
  /** Display name stored beside the id, rewritten to the new node's name. */
  nameColumn: string | null;
};

// Every stored reference to a genre tree id, in one list: the rename carry (its Rust copy in
// src-tauri/src/library_write/genre_carry.rs) and the dangling-id sweep both read it, and
// genreIdTables.test.ts sweeps migrations.ts for any column it missed.
export const GENRE_ID_HOLDERS: readonly GenreIdHolder[] = [
  { table: "tag_mappings", column: "canonical_id", jsonPath: null, nameColumn: null },
  { table: "track_tags", column: "canonical_id", jsonPath: null, nameColumn: null },
  { table: "album_genres", column: "canonical_id", jsonPath: null, nameColumn: "name" },
  { table: "album_user_genres", column: "canonical_id", jsonPath: null, nameColumn: "name" },
  { table: "album_genre_exclusions", column: "canonical_id", jsonPath: null, nameColumn: null },
  { table: "user_tree_nodes", column: "parent_ids", jsonPath: "$", nameColumn: null },
  { table: "playlists", column: "rules_json", jsonPath: "$.selectedGenres", nameColumn: null },
];
