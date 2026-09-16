export interface MirroredTrackRow {
  id: string;
  file_path: string | null;
}

export interface FetchedTrackIdentity {
  /** Already server-prefixed, i.e. the id the mirror would store. */
  id: string;
  path: string | null;
}

export interface TrackIdRemap {
  oldId: string;
  newId: string;
}

/** Index paths that exactly one row claims. A path two rows share identifies neither. */
function uniqueByPath<T>(rows: readonly T[], path: (row: T) => string | null): Map<string, T> {
  const seen = new Map<string, T | null>();
  for (const row of rows) {
    const key = path(row);
    if (key === null || key === "") continue;
    seen.set(key, seen.has(key) ? null : row);
  }
  const unique = new Map<string, T>();
  for (const [key, row] of seen) if (row !== null) unique.set(key, row);
  return unique;
}

/**
 * Pair mirrored rows whose id the server has stopped using with the fetched track holding the
 * same file path, so the rows keyed to the old id can be carried instead of pruned.
 *
 * Navidrome 0.64 re-encoded ~87% of track ids without touching a single file, so to the prune
 * every one of those tracks looks deleted and re-added: loved state, lyrics, waveform, play
 * position and queued scrobbles all die with the old row. The file path is the one thing both
 * sides agree on across the rewrite, which is also why it has to be exact - it is the server's
 * own bytes, not a name to normalise.
 *
 * Conservative on every ambiguity: no path, a path claimed twice on either side, or a new id the
 * mirror already holds all mean "no evidence", and an unmatched stale row is left to the prune.
 */
export function planTrackIdRemap(
  existing: readonly MirroredTrackRow[],
  fetched: readonly FetchedTrackIdentity[]
): TrackIdRemap[] {
  const fetchedIds = new Set(fetched.map((track) => track.id));
  const stale = existing.filter((row) => !fetchedIds.has(row.id));
  if (stale.length === 0) return [];

  const existingIds = new Set(existing.map((row) => row.id));
  const staleByPath = uniqueByPath(stale, (row) => row.file_path);
  const arrivedByPath = uniqueByPath(
    fetched.filter((track) => !existingIds.has(track.id)),
    (track) => track.path
  );

  const remaps: TrackIdRemap[] = [];
  for (const [path, row] of staleByPath) {
    const arrived = arrivedByPath.get(path);
    if (arrived !== undefined) remaps.push({ oldId: row.id, newId: arrived.id });
  }
  return remaps;
}
