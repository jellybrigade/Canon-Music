import { getDb } from "../db";

export async function scanForIssues(serverId: string): Promise<void> {
  const db = await getDb();

  // Remove non-dismissed issues for this server.
  // Dismissed rows survive (INSERT OR IGNORE won't overwrite them),
  // so dismissed issues stay dismissed across rescans.
  await db.execute(
    `DELETE FROM tag_issues
     WHERE track_id IN (SELECT id FROM tracks WHERE server_id = ?)
       AND dismissed_at IS NULL`,
    [serverId]
  );

  await db.execute(
    `INSERT OR IGNORE INTO tag_issues (track_id, issue_type, details)
     SELECT id, 'missing_genre', 'Track has no genre tag'
     FROM tracks WHERE server_id = ? AND (genre IS NULL OR genre = '')`,
    [serverId]
  );

  await db.execute(
    `INSERT OR IGNORE INTO tag_issues (track_id, issue_type, details)
     SELECT id, 'missing_artist', 'Track has no artist tag'
     FROM tracks WHERE server_id = ? AND (artist IS NULL OR artist = '')`,
    [serverId]
  );

  await db.execute(
    `INSERT OR IGNORE INTO tag_issues (track_id, issue_type, details)
     SELECT id, 'suspicious_genre', 'Genre looks like a URL or is unusually long'
     FROM tracks WHERE server_id = ? AND genre IS NOT NULL
       AND (genre LIKE 'http%' OR LENGTH(genre) > 60)`,
    [serverId]
  );

  await db.execute(
    `INSERT OR IGNORE INTO tag_issues (track_id, issue_type, details)
     SELECT t.id, 'inconsistent_album_artist',
            'Album has multiple distinct artist values with no album_artist tag'
     FROM tracks t
     WHERE t.server_id = ? AND t.album_artist IS NULL
       AND t.album_id IN (
         SELECT album_id FROM tracks WHERE server_id = ?
         GROUP BY album_id
         HAVING COUNT(DISTINCT COALESCE(artist, '')) > 1
       )`,
    [serverId, serverId]
  );

  await db.execute(
    `INSERT OR IGNORE INTO tag_issues (track_id, issue_type, details)
     SELECT DISTINCT t.id, 'duplicate_album',
            'Multiple albums share the same name and artist'
     FROM tracks t
     JOIN albums a ON t.album_id = a.id
     WHERE a.server_id = ?
       AND a.id IN (
         SELECT a2.id FROM albums a2
         WHERE a2.server_id = ?
           AND (LOWER(a2.name) || '|' || LOWER(COALESCE(a2.artist, ''))) IN (
             SELECT LOWER(a3.name) || '|' || LOWER(COALESCE(a3.artist, ''))
             FROM albums a3 WHERE a3.server_id = ?
             GROUP BY LOWER(a3.name), LOWER(COALESCE(a3.artist, ''))
             HAVING COUNT(*) > 1
           )
       )`,
    [serverId, serverId, serverId]
  );
}
