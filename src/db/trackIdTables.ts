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
};

// Single source for prune, purge and remap; trackIdTables.test.ts catches new track-id tables.
// Delete order, dependants first; `tracks` itself is handled by callers. Scrobbles and resume
// positions are user history, so they survive a prune but go with the server.
export const TRACK_ID_TABLES: readonly TrackIdTable[] = [
  { table: "tracks_fts", column: "id", pruned: true, purged: true, remapped: false, inert: false },
  { table: "track_tags", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "loved_tracks", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "playlist_tracks", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "tag_issues", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "lyrics", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
  { table: "waveform_cache", column: "track_id", pruned: true, purged: true, remapped: true, inert: false },
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
