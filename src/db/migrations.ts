export interface Migration {
  version: number;
  sql: string;
}

/**
 * The subset of tauri-plugin-sql's `Database` that `runMigrations` needs. Declared here so the
 * test harness can drive the real runner instead of re-implementing it, which is what let the
 * two copies drift apart before.
 */
export interface MigrationDb {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/**
 * Thrown when the database records a schema version this build does not know about, which means
 * it was written by a newer Canon and there is no downgrade path.
 */
export class SchemaTooNewError extends Error {
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(
      `This library was created by a newer version of Canon (database schema v${found}, this build understands up to v${supported}). Update Canon to open it.`
    );
    this.name = "SchemaTooNewError";
    this.found = found;
    this.supported = supported;
  }
}

export async function runMigrations(database: MigrationDb): Promise<void> {
  // WAL mode lets reads proceed while a write is in flight instead of exclusive-locking the
  // whole file; sqlx's default pool otherwise opens several connections against a rollback-journal
  // (DELETE mode) db, so concurrent sync/scrobble/enrichment writes can starve UI reads with
  // "database is locked" errors. WAL is a persistent on-disk setting, but PRAGMA is cheap to re-run.
  await database.execute("PRAGMA journal_mode=WAL");

  await database.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    )
  `);

  type Row = { version: number };
  const rows = await database.select<Row[]>(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
  );
  const current = rows[0]?.version ?? 0;

  // A high-water mark answers "what still needs running", never "is this file too new for me".
  // Without this the loop body simply never executes and the older build then runs its own
  // queries against a newer schema, failing scattered and late instead of once and clearly.
  if (current > LATEST_SCHEMA_VERSION) {
    throw new SchemaTooNewError(current, LATEST_SCHEMA_VERSION);
  }

  for (const migration of migrations) {
    if (migration.version > current) {
      // tauri-plugin-sql only executes one statement per execute() call;
      // split on ";" and run each non-empty statement individually.
      const statements = migration.sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // A block has to be all-or-nothing. Several blocks are only correct as a sequence - v25 and
      // v35 rebuild track_tags as create/copy/drop/rename, so a process that dies between the DROP
      // and the RENAME leaves every tag in a table the app cannot see, and the replay on the next
      // launch dies on the CREATE forever. The version row goes inside the same transaction: a
      // block that ran but was not recorded is replayed against a database it already changed.
      //
      // BEGIN / COMMIT only work here because the statements of one block reach the same
      // connection. tauri-plugin-sql runs every execute() through an sqlx pool with no connection
      // affinity, but these awaits are strictly sequential and `getDb()` gates every other caller
      // behind the same promise, so the pool never has cause to open a second connection while a
      // migration is in flight. Anything that starts issuing queries concurrently with the runner
      // breaks that, and would need the block moved behind a single Rust-side transaction instead.
      await database.execute("BEGIN");
      try {
        for (const statement of statements) {
          try {
            await database.execute(statement);
          } catch (e) {
            // Ignore "duplicate column name", ALTER TABLE ADD COLUMN on an already-existing column.
            // Happens when a migration version was recorded but the DDL ran twice (e.g. HMR race).
            // SQLite rolls back the failed statement only, so the surrounding transaction survives.
            // tauri-plugin-sql rejects with a plain string, not an Error instance, so check both shapes.
            const message = e instanceof Error ? e.message : String(e);
            if (!message.includes("duplicate column name")) throw e;
          }
        }
        await database.execute(
          "INSERT INTO schema_migrations (version) VALUES (?)",
          [migration.version]
        );
        await database.execute("COMMIT");
      } catch (e) {
        // A ROLLBACK that fails must not replace the error that says what actually went wrong.
        try {
          await database.execute("ROLLBACK");
        } catch {
          /* keep the original failure */
        }
        throw e;
      }
    }
  }
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        server_type TEXT NOT NULL CHECK (server_type IN ('navidrome')),
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
        server_type TEXT NOT NULL CHECK (server_type IN ('navidrome')),
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
        server_type TEXT NOT NULL CHECK (server_type IN ('navidrome')),
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
        type TEXT NOT NULL CHECK (type IN ('navidrome')),
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
  {
    version: 26,
    sql: `
      CREATE TABLE IF NOT EXISTS album_user_genres (
        album_id     TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        name         TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (album_id, canonical_id)
      );
    `,
  },
  {
    version: 27,
    sql: `
      ALTER TABLE tag_mappings ADD COLUMN norm_value TEXT;
      UPDATE tag_mappings SET norm_value = LOWER(REPLACE(REPLACE(TRIM(raw_value), '-', ' '), '_', ' '));
      CREATE INDEX IF NOT EXISTS idx_tag_mappings_norm ON tag_mappings(norm_value, kind);

      CREATE TABLE IF NOT EXISTS tag_vocab_cache (
        norm_value  TEXT NOT NULL,
        raw_value   TEXT NOT NULL,
        kind        TEXT NOT NULL,
        album_count INTEGER NOT NULL DEFAULT 0,
        sources     TEXT,
        PRIMARY KEY (norm_value, kind)
      );

      INSERT OR IGNORE INTO tag_vocab_cache (norm_value, raw_value, kind, album_count, sources)
      SELECT
        LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' ')),
        tt.raw_value,
        tt.kind,
        COUNT(DISTINCT tr.album_id),
        GROUP_CONCAT(DISTINCT CASE WHEN tt.source = 'server' THEN 'file' ELSE tt.source END)
      FROM track_tags tt
      JOIN tracks tr ON tr.id = tt.track_id
      GROUP BY LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' ')), tt.kind;
    `,
  },
  {
    version: 28,
    sql: `ALTER TABLE albums ADD COLUMN release_type TEXT;`,
  },
  {
    version: 29,
    sql: `ALTER TABLE lyrics ADD COLUMN offset_ms INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 30,
    sql: `ALTER TABLE servers ADD COLUMN alt_url TEXT;`,
  },
  {
    version: 31,
    sql: `ALTER TABLE playlists ADD COLUMN cover_art_url TEXT;`,
  },
  {
    version: 32,
    sql: `
      ALTER TABLE tracks ADD COLUMN bit_rate INTEGER;
      ALTER TABLE tracks ADD COLUMN suffix TEXT;
      ALTER TABLE tracks ADD COLUMN file_size INTEGER;
    `,
  },
  {
    version: 33,
    sql: `
      CREATE TABLE IF NOT EXISTS album_genre_exclusions (
        album_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        excluded_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (album_id, canonical_id)
      );
    `,
  },
  {
    version: 34,
    sql: `
      CREATE TABLE IF NOT EXISTS playlist_resume (
        playlist_id TEXT NOT NULL PRIMARY KEY,
        last_track_id TEXT NOT NULL,
        track_position INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 35,
    sql: `
      ALTER TABLE tracks ADD COLUMN tags_enriched_at INTEGER;

      CREATE TABLE track_tags_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('genre','mood')),
        raw_value TEXT NOT NULL,
        canonical_id TEXT,
        source TEXT NOT NULL CHECK (source IN ('server','lastfm','lastfm-track','manual','musicbrainz','musicbrainz-folksonomy')),
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
  {
    version: 36,
    sql: `ALTER TABLE playlists ADD COLUMN custom_cover_data TEXT;`,
  },
  {
    version: 37,
    sql: `
      ALTER TABLE tracks ADD COLUMN replay_gain_track_gain REAL;
      ALTER TABLE tracks ADD COLUMN replay_gain_track_peak REAL;
      ALTER TABLE tracks ADD COLUMN replay_gain_album_gain REAL;
      ALTER TABLE tracks ADD COLUMN replay_gain_album_peak REAL;
    `,
  },
  {
    version: 38,
    sql: `
      CREATE TABLE IF NOT EXISTS artist_aliases (
        alias_name TEXT NOT NULL PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_artist_aliases_canonical ON artist_aliases(canonical_name);
    `,
  },
  {
    version: 39,
    sql: `ALTER TABLE albums ADD COLUMN accent_color TEXT;`,
  },
  {
    version: 40,
    sql: `
      ALTER TABLE playlists ADD COLUMN is_smart INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE playlists ADD COLUMN rules_json TEXT;
    `,
  },
  {
    version: 41,
    sql: `
      CREATE TABLE IF NOT EXISTS radio_signal_cache (
        cache_key TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 42,
    sql: `
      ALTER TABLE album_identity ADD COLUMN album_bio TEXT;
      ALTER TABLE album_identity ADD COLUMN lastfm_url TEXT;
      ALTER TABLE album_identity ADD COLUMN album_enriched_at INTEGER;
    `,
  },
  {
    version: 43,
    sql: `
      CREATE TABLE IF NOT EXISTS album_covers (
        album_id TEXT PRIMARY KEY,
        data_url TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 44,
    sql: `
      CREATE TABLE IF NOT EXISTS artist_covers (
        artist_name TEXT PRIMARY KEY,
        data_url TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 45,
    sql: `
      CREATE TABLE IF NOT EXISTS app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );
    `,
  },
  {
    version: 46,
    sql: `ALTER TABLE artist_identity ADD COLUMN navidrome_image_url TEXT;`,
  },
  {
    version: 47,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_albums_artist_server_artwork ON albums(artist, server_id) WHERE artwork_url IS NOT NULL;
    `,
  },
  {
    // The server's own "last played" timestamp. Without it the listening-stats
    // carousels only ever know about plays Canon itself scrobbled, so a fresh
    // install against a long-established server shows an empty "On Repeat" and
    // sorts "From the Vault" on empty strings.
    version: 48,
    sql: `ALTER TABLE albums ADD COLUMN played_at TEXT;`,
  },
];

/** Highest schema version this build can produce, and the ceiling the too-new guard compares against. */
export const LATEST_SCHEMA_VERSION = Math.max(...migrations.map((m) => m.version));
