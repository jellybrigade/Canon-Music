// Read-only connection to the same canon.db file tauri-plugin-sql writes/migrates,
// avoiding per-query IPC-to-sqlx round trips for hot-path list queries.
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

pub mod albums;
pub mod artists;
pub mod genres;
pub mod loved;
pub mod playlists;
pub mod tags;
pub mod tracks;

#[derive(Default)]
pub struct LibraryReadStore {
    conn: Mutex<Option<Connection>>,
}

impl LibraryReadStore {
    fn with_conn<T>(
        &self,
        app: &tauri::AppHandle,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| "library read store lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(open_read_conn(app)?);
        }
        f(guard.as_ref().expect("just set"))
    }

    /// Library views show the active server only; with no server there is nothing to show.
    fn with_active_server<T: Default>(
        &self,
        app: &tauri::AppHandle,
        f: impl FnOnce(&Connection, &str) -> Result<T, String>,
    ) -> Result<T, String> {
        self.with_conn(app, |conn| match active_server_id(conn)? {
            Some(server_id) => f(conn, &server_id),
            None => Ok(T::default()),
        })
    }
}

// Same choice as the app's `servers?.[0]` from `useServers` (oldest first), plus an id tiebreak.
fn active_server_id(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM servers ORDER BY created_at, id LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // tauri-plugin-sql resolves "sqlite:canon.db" against app_config_dir, not
    // app_data_dir (confirmed in its wrapper.rs `DbPool::connect`) - must match.
    app.path()
        .app_config_dir()
        .map(|d| d.join("canon.db"))
        .map_err(|e| e.to_string())
}

fn open_read_conn(app: &tauri::AppHandle) -> Result<Connection, String> {
    open_read_conn_at(&db_path(app)?)
}

fn open_read_conn_at(path: &std::path::Path) -> Result<Connection, String> {
    // READ_WRITE despite SELECT-only: a read-only connection can't create the WAL -shm if it
    // opens first. No CREATE, so a wrong path errors instead of making an empty db.
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "cache_size", -64_000)
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir per test, removed on drop. Avoids pulling in `tempfile`
    /// as a dev-dependency (same reasoning as cover.rs and streaming.rs).
    struct ScratchDir(std::path::PathBuf);

    impl ScratchDir {
        fn new(label: &str) -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "canon-library-read-test-{label}-{}-{n}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch dir");
            ScratchDir(dir)
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn server_conn(rows: &str) -> Connection {
        let conn = Connection::open_in_memory().expect("db");
        conn.execute_batch(&format!(
            "CREATE TABLE servers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL); {rows}"
        ))
        .expect("seed");
        conn
    }

    #[test]
    fn the_active_server_is_the_oldest_one_like_the_apps_first_server() {
        let conn =
            server_conn("INSERT INTO servers VALUES ('new', '2026-02-01'), ('old', '2026-01-01')");
        assert_eq!(active_server_id(&conn).unwrap().as_deref(), Some("old"));
    }

    #[test]
    fn servers_added_in_the_same_second_resolve_to_one_active_server_by_id() {
        let conn =
            server_conn("INSERT INTO servers VALUES ('b', '2026-01-01'), ('a', '2026-01-01')");
        assert_eq!(active_server_id(&conn).unwrap().as_deref(), Some("a"));
    }

    #[test]
    fn with_no_server_there_is_no_active_server() {
        let conn = server_conn("");
        assert_eq!(active_server_id(&conn).unwrap(), None);
    }

    #[test]
    fn a_missing_database_file_errors_instead_of_being_created() {
        let scratch = ScratchDir::new("no-create");
        let path = scratch.0.join("canon.db");

        let err = open_read_conn_at(&path).expect_err("a missing db must not open");

        assert!(!err.is_empty(), "error must be reported, not swallowed");
        assert!(
            !path.exists(),
            "SQLITE_OPEN_CREATE is deliberately omitted - an empty db here would \
             shadow the real one instead of failing loudly"
        );
    }

    #[test]
    fn every_wal_connection_syncs_at_normal_not_full() {
        // synchronous is per connection and sqlx's pool has no per-connection hook, so the
        // bundled SQLite is built with SQLITE_DEFAULT_WAL_SYNCHRONOUS=1 (.cargo/config.toml).
        let scratch = ScratchDir::new("synchronous");
        let path = scratch.0.join("canon.db");
        let writer = Connection::open(&path).expect("writer");
        writer
            .pragma_update(None, "journal_mode", "WAL")
            .expect("wal");

        let conn = open_read_conn_at(&path).expect("existing db must open");
        let synchronous: i64 = conn
            .query_row("PRAGMA synchronous", [], |r| r.get(0))
            .expect("read synchronous");
        assert_eq!(synchronous, 1, "1 = NORMAL; 2 = FULL fsyncs every commit");
    }

    #[test]
    fn an_existing_database_opens_read_write_so_it_can_participate_in_wal() {
        let scratch = ScratchDir::new("wal");
        let path = scratch.0.join("canon.db");
        {
            let writer = Connection::open(&path).expect("writer");
            writer
                .pragma_update(None, "journal_mode", "WAL")
                .expect("wal");
            writer
                .execute_batch(
                    "CREATE TABLE settings (value TEXT); INSERT INTO settings VALUES ('x')",
                )
                .expect("seed");
        }

        let conn = open_read_conn_at(&path).expect("existing db must open");
        let v: String = conn
            .query_row("SELECT value FROM settings", [], |r| r.get(0))
            .expect("read back");
        assert_eq!(v, "x");
        // READ_ONLY is the flag that broke this once: it cannot recover a -wal/-shm
        // pair the writer pool has not established yet.
        assert!(
            conn.execute("INSERT INTO settings VALUES ('y')", [])
                .is_ok(),
            "connection is opened READ_WRITE by design, even though it issues no writes"
        );
    }
}

#[cfg(test)]
mod test_fixtures {
    use rusqlite::Connection;

    // Mirrors src/db/migrations.ts's post-ALTER shape by hand, since this connection never
    // runs those migrations; a rename there breaks these queries with "no such column".
    pub(super) const FIXTURE_DDL: &str = "
        CREATE TABLE servers (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE albums (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          artist TEXT, album_artist TEXT, year INTEGER, artwork_url TEXT,
          release_type TEXT, accent_color TEXT, navidrome_created TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE tracks (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, title TEXT NOT NULL,
          artist TEXT, album_artist TEXT, album_id TEXT, genre TEXT,
          track_number INTEGER, disc_number INTEGER, year INTEGER, duration INTEGER,
          file_path TEXT, play_count INTEGER, bit_rate INTEGER, suffix TEXT,
          file_size INTEGER,
          replay_gain_track_gain REAL, replay_gain_track_peak REAL,
          replay_gain_album_gain REAL, replay_gain_album_peak REAL
        );
        CREATE TABLE artists (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          album_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE artist_identity (
          artist_name TEXT PRIMARY KEY, lastfm_image_url TEXT,
          wikidata_image_url TEXT, navidrome_image_url TEXT, enriched_at INTEGER
        );
        CREATE TABLE artist_aliases (
          alias_name TEXT NOT NULL PRIMARY KEY, canonical_name TEXT NOT NULL
        );
        CREATE TABLE album_genres (
          album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          relation TEXT NOT NULL CHECK (relation IN ('direct','ancestor')),
          section TEXT, name TEXT NOT NULL,
          PRIMARY KEY (album_id, canonical_id)
        );
        CREATE TABLE scrobble_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL, scrobbled_at TEXT NOT NULL
        );
        CREATE TABLE loved_tracks (track_id TEXT PRIMARY KEY);
        CREATE TABLE loved_albums (album_id TEXT PRIMARY KEY);
        CREATE TABLE playlists (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          comment TEXT, track_count INTEGER, cover_art_url TEXT,
          custom_cover_data TEXT, is_smart INTEGER, rules_json TEXT
        );
        CREATE TABLE tag_vocab_cache (
          norm_value TEXT NOT NULL, raw_value TEXT NOT NULL, kind TEXT NOT NULL,
          album_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (norm_value, kind)
        );
        CREATE TABLE tag_mappings (
          raw_value TEXT NOT NULL, kind TEXT NOT NULL, canonical_id TEXT NOT NULL,
          norm_value TEXT, PRIMARY KEY (raw_value, kind)
        );
    ";

    pub(super) fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(FIXTURE_DDL).expect("fixture ddl");
        conn
    }

    /// `(id, server_id, name, artist)`, everything else NULL.
    pub(super) fn insert_album(
        conn: &Connection,
        id: &str,
        server: &str,
        name: &str,
        artist: &str,
    ) {
        conn.execute(
            "INSERT INTO albums (id, server_id, name, artist) VALUES (?, ?, ?, ?)",
            [id, server, name, artist],
        )
        .expect("insert album");
    }

    /// Tags `album_id`, creating it on server `s1` if no album row exists yet.
    pub(super) fn insert_genre(
        conn: &Connection,
        album_id: &str,
        canonical_id: &str,
        relation: &str,
    ) {
        insert_named_genre(conn, album_id, canonical_id, relation, canonical_id);
    }

    pub(super) fn insert_named_genre(
        conn: &Connection,
        album_id: &str,
        canonical_id: &str,
        relation: &str,
        name: &str,
    ) {
        conn.execute(
            "INSERT OR IGNORE INTO albums (id, server_id, name) VALUES (?, 's1', ?)",
            [album_id, album_id],
        )
        .expect("insert album");
        conn.execute(
            "INSERT INTO album_genres (album_id, canonical_id, relation, name)
             VALUES (?, ?, ?, ?)",
            [album_id, canonical_id, relation, name],
        )
        .expect("insert album_genre");
    }
}
