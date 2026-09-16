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

// One list, because a hand-kept copy per call site is a copy that goes stale: the prune, the
// server purge and the id remap all read this. A new table with a track id column is caught by
// track-id-tables.test.ts, which sweeps migrations.ts rather than trusting the next reader.
//
// Order is delete order - dependants first, so a subselect against `tracks` still resolves. The
// `tracks` row itself is not here; every caller deletes or rewrites it last, on its own terms.
//
// Why a table is not pruned: scrobble_queue and scrobble_history are the user's listening
// history, not the server's data, so a track vanishing from the server does not erase that it
// was played. playlist_resume holds a position the user left off at. All three still go when the
// server itself is removed, since their ids can never resolve again.
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

/**
 * Tables carried onto the new id when the server rewrites its own track ids (Navidrome 0.64 did,
 * for ~87% of them). `tracks_fts` is not among them: `rebuildTracksFts` in src/lib/sync.ts rewrites
 * its rows from `tracks` for every album the pass touched, so carrying them would be work that is
 * immediately overwritten. It is that rebuild, and only it, that also deletes the row under the old
 * id - a renamed track keeps its `tracks` row, so the prune never reaches the id it left behind.
 */
export function remappedTrackIdTables(): readonly TrackIdTable[] {
  return TRACK_ID_TABLES.filter((entry) => entry.remapped);
}
