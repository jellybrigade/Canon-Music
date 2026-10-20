// The artists table holds album artists only, but search lists track artists too, so anything
// keyed by an artist name search can show checks both. Arguments are SQL: column refs or `?`.
export const artistInLibrarySql = (serverId: string, name: string) =>
  `(EXISTS (SELECT 1 FROM artists WHERE server_id = ${serverId} AND name = ${name})
    OR EXISTS (SELECT 1 FROM tracks WHERE server_id = ${serverId} AND artist = ${name}))`;

// Matches search's count for a track-only artist: the albums they appear on.
export const artistAlbumCountSql = (serverId: string, name: string) =>
  `COALESCE((SELECT album_count FROM artists WHERE server_id = ${serverId} AND name = ${name}),
    (SELECT COUNT(DISTINCT album_id) FROM tracks WHERE server_id = ${serverId} AND artist = ${name}))`;
