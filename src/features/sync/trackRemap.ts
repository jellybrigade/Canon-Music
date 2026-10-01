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
 * Pairs stale mirrored track ids to the fetched track at the same file path, so rows
 * carry instead of pruning. Any ambiguity pairs nothing and leaves the row to the prune.
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
