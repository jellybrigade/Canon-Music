export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        server_type TEXT NOT NULL CHECK (server_type IN ('navidrome', 'jellyfin', 'plex')),
        title TEXT NOT NULL,
        artist TEXT,
        album_artist TEXT,
        album_id TEXT,
        genre TEXT,
        track_number INTEGER,
        disc_number INTEGER,
        year INTEGER,
        duration INTEGER,
        last_modified TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        server_type TEXT NOT NULL CHECK (server_type IN ('navidrome', 'jellyfin', 'plex')),
        name TEXT NOT NULL,
        artist TEXT,
        album_artist TEXT,
        year INTEGER,
        artwork_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS artists (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        server_type TEXT NOT NULL CHECK (server_type IN ('navidrome', 'jellyfin', 'plex')),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pending_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source TEXT NOT NULL CHECK (source IN ('manual', 'lastfm', 'genre_unifier')),
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS edit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source TEXT NOT NULL,
        written_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS scrobble_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        timestamp INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS scrobble_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        scrobbled_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (track_id, timestamp)
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('navidrome', 'jellyfin', 'plex')),
        url TEXT NOT NULL,
        display_name TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS loved_tracks (
        track_id TEXT PRIMARY KEY,
        loved_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS loved_albums (
        album_id TEXT PRIMARY KEY,
        loved_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
        id UNINDEXED,
        title,
        artist,
        album,
        genre,
        tokenize='unicode61'
      );
    `,
  },
  {
    version: 6,
    sql: `ALTER TABLE albums ADD COLUMN navidrome_created TEXT;`,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        name TEXT NOT NULL,
        comment TEXT,
        track_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, position)
      );
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE tracks ADD COLUMN file_path TEXT;

      ALTER TABLE servers ADD COLUMN sidecar_url TEXT;
      ALTER TABLE servers ADD COLUMN sidecar_secret_key TEXT;
      ALTER TABLE servers ADD COLUMN sidecar_path_prefix_from TEXT;
      ALTER TABLE servers ADD COLUMN sidecar_path_prefix_to TEXT;

      CREATE TABLE IF NOT EXISTS genre_mappings (
        raw_genre TEXT PRIMARY KEY,
        canonical_genre TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tag_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        details TEXT,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(track_id, issue_type)
      );
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS track_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('genre','mood')),
        raw_value TEXT NOT NULL,
        canonical_id TEXT,
        source TEXT NOT NULL CHECK (source IN ('server','lastfm','manual')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(track_id, kind, raw_value, source)
      );

      CREATE INDEX IF NOT EXISTS idx_track_tags_canonical ON track_tags(canonical_id);
      CREATE INDEX IF NOT EXISTS idx_track_tags_track ON track_tags(track_id);

      ALTER TABLE albums ADD COLUMN tags_refreshed_at TEXT;

      DROP TABLE IF EXISTS genre_mappings;

      CREATE TABLE IF NOT EXISTS tag_mappings (
        raw_value TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('genre','mood')),
        canonical_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (raw_value, kind)
      );

      CREATE TABLE IF NOT EXISTS user_tree_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('genre','mood','category')),
        canonical_key TEXT NOT NULL,
        parent_ids TEXT NOT NULL DEFAULT '[]'
      );

      INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, source)
      SELECT id, 'genre', genre, 'server'
      FROM tracks
      WHERE genre IS NOT NULL AND genre != '';
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE tag_issues ADD COLUMN dismissed_at TEXT;
      ALTER TABLE artists ADD COLUMN album_count INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS lyrics (
        track_id TEXT PRIMARY KEY,
        plain TEXT,
        synced TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE albums ADD COLUMN normalized_tags_json TEXT;
      ALTER TABLE albums ADD COLUMN computed_at INTEGER;
    `,
  },
  {
    version: 12,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
      CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
      CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE tag_mappings ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE tag_mappings ADD COLUMN match_type TEXT;
    `,
  },
  {
    version: 14,
    sql: `
      ALTER TABLE tag_mappings ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS album_identity (
        album_id TEXT PRIMARY KEY,
        mb_release_group_id TEXT,
        mb_release_id TEXT,
        mb_artist_id TEXT,
        lastfm_artist_name TEXT,
        lastfm_album_name TEXT,
        lastfm_match_confirmed INTEGER NOT NULL DEFAULT 0,
        combined_genres_json TEXT,
        label TEXT,
        country TEXT,
        catalog_number TEXT,
        barcode TEXT,
        release_date TEXT,
        confirmed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS artist_identity (
        artist_name TEXT PRIMARY KEY,
        mb_artist_id TEXT,
        lastfm_artist_name TEXT,
        confirmed_at INTEGER
      );
    `,
  },
  {
    version: 16,
    sql: `
      ALTER TABLE album_identity ADD COLUMN auto_matched INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE album_identity ADD COLUMN match_score INTEGER;
      ALTER TABLE album_identity ADD COLUMN looked_up_at INTEGER;
    `,
  },
  {
    version: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS album_genres (
        album_id     TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        relation     TEXT NOT NULL CHECK (relation IN ('direct','ancestor')),
        section      TEXT,
        name         TEXT NOT NULL,
        PRIMARY KEY (album_id, canonical_id)
      );
      CREATE INDEX IF NOT EXISTS idx_album_genres_canonical ON album_genres(canonical_id);

      CREATE TABLE IF NOT EXISTS album_unresolved_genres (
        album_id  TEXT NOT NULL,
        raw_value TEXT NOT NULL,
        kind      TEXT NOT NULL DEFAULT 'genre',
        source    TEXT NOT NULL,
        PRIMARY KEY (album_id, raw_value, kind)
      );
    `,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE IF NOT EXISTS waveform_cache (
        track_id   TEXT PRIMARY KEY,
        peaks_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 19,
    sql: `ALTER TABLE albums ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 20,
    sql: `
      ALTER TABLE artist_identity ADD COLUMN bio TEXT;
      ALTER TABLE artist_identity ADD COLUMN listeners INTEGER;
      ALTER TABLE artist_identity ADD COLUMN playcount INTEGER;
      ALTER TABLE artist_identity ADD COLUMN similar_json TEXT;
      ALTER TABLE artist_identity ADD COLUMN top_tags_json TEXT;
      ALTER TABLE artist_identity ADD COLUMN lastfm_image_url TEXT;
      ALTER TABLE artist_identity ADD COLUMN enriched_at INTEGER;
    `,
  },
  {
    version: 21,
    sql: `ALTER TABLE artist_identity ADD COLUMN wikidata_image_url TEXT;`,
  },
  {
    version: 22,
    sql: `ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // v22 was recorded in schema_migrations on some installs but the DDL silently
    // did not execute (WAL / HMR race). Re-issuing here so those installs get the
    // column. The runner swallows "duplicate column name" for installs where v22 ran.
    version: 23,
    sql: `ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 24,
    sql: `
      CREATE TABLE IF NOT EXISTS user_tree_changelog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        node_name TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 25,
    sql: `
      ALTER TABLE album_identity ADD COLUMN combined_tags_json TEXT;

      CREATE TABLE track_tags_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('genre','mood')),
        raw_value TEXT NOT NULL,
        canonical_id TEXT,
        source TEXT NOT NULL CHECK (source IN ('server','lastfm','manual','musicbrainz','musicbrainz-folksonomy')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(track_id, kind, raw_value, source)
      );
      INSERT INTO track_tags_new SELECT * FROM track_tags;
      DROP TABLE track_tags;
      ALTER TABLE track_tags_new RENAME TO track_tags;
      CREATE INDEX IF NOT EXISTS idx_track_tags_canonical ON track_tags(canonical_id);
      CREATE INDEX IF NOT EXISTS idx_track_tags_track ON track_tags(track_id);
    `,
  },
];
