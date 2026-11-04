/**
 * SQL that holds for a row of `album_release_lookups` aliased `lookup` that still describes the
 * album aliased `album`: a lookup made under another name, artist or year says nothing about it.
 */
export function currentLookupSql(lookup: string, album: string): string {
  return `${lookup}.album_id = ${album}.id AND ${lookup}.server_id = ${album}.server_id
    AND ${lookup}.looked_up_name = ${album}.name AND ${lookup}.looked_up_artist IS ${album}.artist
    AND ${lookup}.looked_up_year IS ${album}.year`;
}

/** The earliest date a source found for the album, only when its year is the album's; else NULL. */
export function lookedUpReleaseDateSql(album: string): string {
  return `(SELECT MIN(lookup.release_date) FROM album_release_lookups lookup
    WHERE ${currentLookupSql("lookup", album)} AND lookup.status = 'found'
      AND substr(lookup.release_date, 1, 4) = printf('%04d', ${album}.year))`;
}

/** Holds when a source showed the album is a later edition of older music. */
export function lookedUpReissueSql(album: string): string {
  return `EXISTS (SELECT 1 FROM album_release_lookups lookup
    WHERE ${currentLookupSql("lookup", album)} AND lookup.is_reissue = 1)`;
}

/** The album's full date from its tags (release, then original) or MusicBrainz, of its own year; else NULL. */
export function ownReleaseDateSql(album: string, identity: string): string {
  const ofAlbumYear = (column: string) =>
    `WHEN length(${column}) > 4 AND substr(${column}, 1, 4) = printf('%04d', ${album}.year) THEN ${column}`;
  return `(CASE
    ${ofAlbumYear(`${album}.release_date`)}
    ${ofAlbumYear(`${album}.original_release_date`)}
    ${ofAlbumYear(`${identity}.release_date`)}
  END)`;
}
