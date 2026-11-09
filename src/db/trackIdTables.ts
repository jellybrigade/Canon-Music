export type TrackIdTable = {
  table: string;
  /** The column holding the track id. `tracks_fts` and only it calls it `id`. */
  column: string;
  /** Deleted when the server stops listing the track. */
  pruned: boolean;
  /** Deleted when the server row itself goes. */
  purged: boolean;
  /** Carried onto the new id when the server rewrites its own track ids. */
  remapped: boolean;
  /** Legacy schema no read path reaches: never deleted, never carried. */
  inert: boolean;
  /** Rows sit at their track's rowid, so deletes find them by it; matching the unindexed id scans the table. */
  keyedByTrackRowid?: true;
};

// Single source for prune, purge and remap; trackIdTables.test.ts catches new track-id tables.
// Delete order, dependants first; `tracks` itself is handled by callers. Scrobbles and resume
// positions are user history, so they survive a prune but go with the server.
export const TRACK_ID_TABLES: readonly TrackIdTable[] = [
  {
    table: "tracks_fts",
    column: "id",
    pruned: true,
    purged: true,
    remapped: false,
    inert: false,
    keyedByTrackRowid: true,
  },
  { table: "track_tags", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "loved_tracks", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "playlist_tracks", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "tag_issues", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "lyrics", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "waveform_cache", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "recent_tracks", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "scrobble_queue", column: "track_id", pruned: false, purged: true, remapped: true, inert: false },
  { table: "scrobble_history", column: "track_id", pruned: false, purged: true, remapped: true, inert: false },
  { table: "playlist_resume", column: "last_track_id", pruned: false, purged: true, remapped: true, inert: false },
  { table: "pending_edits", column: "track_id", pruned: false, purged: false, remapped: false, inert: true },
  { table: "edit_history", column: "track_id", pruned: false, purged: false, remapped: false, inert: true },
];

export function prunedTrackIdTables(): readonly TrackIdTable[] {
  return TRACK_ID_TABLES.filter((entry) => entry.pruned);
}

export function purgedTrackIdTables(): readonly TrackIdTable[] {
  return TRACK_ID_TABLES.filter((entry) => entry.purged);
}

/** Tables carried onto the new id when the server rewrites track ids. `tracks_fts` is excluded, rebuilt instead by `rebuildTracksFts`. */
export function remappedTrackIdTables(): readonly TrackIdTable[] {
  return TRACK_ID_TABLES.filter((entry) => entry.remapped);
}

/** Deletes `entry`'s rows for the tracks whose ids `trackIdsSql` lists (placeholders or a subselect); run before the track rows go. */
export function deleteTrackRowsSql(entry: TrackIdTable, trackIdsSql: string): string {
  if (entry.keyedByTrackRowid) {
    return `DELETE FROM ${entry.table} WHERE rowid IN (SELECT rowid FROM tracks WHERE id IN (${trackIdsSql}))`;
  }
  return `DELETE FROM ${entry.table} WHERE ${entry.column} IN (${trackIdsSql})`;
}
