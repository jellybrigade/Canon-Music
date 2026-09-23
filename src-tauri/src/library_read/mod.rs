// Pilot for the tauri-plugin-sql -> rusqlite migration (psysonic pattern, see
// instructions/donow.md "rusqlite write/read split"). Read-only connection to the
// same canon.db file tauri-plugin-sql already writes/migrates - avoids per-query
// IPC-to-sqlx round trips for hot-path list queries. Writes and migrations stay on
// tauri-plugin-sql for now; only read commands piloted here (albums first).
use rusqlite::{Connection, OpenFlags};
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
    // Opened READ_WRITE despite only ever running SELECTs. canon.db is in WAL mode
    // (src/db/migrations.ts), and a SQLITE_OPEN_READ_ONLY connection cannot create or
    // recover the -wal/-shm shared-memory files - it can only attach to ones a writer
    // already owns. Since this connection can open before the tauri-plugin-sql writer
    // pool has established them, READ_ONLY makes every query here fail with
    // SQLITE_READONLY / "unable to open database file" depending on launch ordering.
    // READ_WRITE lets it participate in WAL normally. CREATE is deliberately omitted so
    // a missing/misresolved path errors out instead of silently creating an empty db
    // that would shadow the real one.
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
    fn an_existing_database_opens_read_write_so_it_can_participate_in_wal() {
        let scratch = ScratchDir::new("wal");
        let path = scratch.0.join("canon.db");
        {
            let writer = Connection::open(&path).expect("writer");
            writer
                .pragma_update(None, "journal_mode", "WAL")
                .expect("wal");
            writer
                .execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('x')")
                .expect("seed");
        }

        let conn = open_read_conn_at(&path).expect("existing db must open");
        let v: String = conn
            .query_row("SELECT v FROM t", [], |r| r.get(0))
            .expect("read back");
        assert_eq!(v, "x");
        // READ_ONLY is the flag that broke this once: it cannot recover a -wal/-shm
        // pair the writer pool has not established yet.
        assert!(
            conn.execute("INSERT INTO t VALUES ('y')", []).is_ok(),
            "connection is opened READ_WRITE by design, even though it issues no writes"
        );
    }
}

#[cfg(test)]
mod test_fixtures {
    use rusqlite::Connection;

    // Hand-written DDL, post-ALTER shape, for only the tables these queries read.
    // src/db/migrations.ts owns the real schema and this connection never sees it -
    // tauri-plugin-sql migrates the file before any read command runs. Replaying 50
    // TS migrations from Rust is not possible, so this mirrors them instead; when a
    // column below is renamed there, the query tests fail with "no such column".
    pub(super) const FIXTURE_DDL: &str = "
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

    pub(super) fn insert_genre(
        conn: &Connection,
        album_id: &str,
        canonical_id: &str,
        relation: &str,
    ) {
        conn.execute(
            "INSERT INTO album_genres (album_id, canonical_id, relation, name)
             VALUES (?, ?, ?, ?)",
            [album_id, canonical_id, relation, canonical_id],
        )
        .expect("insert album_genre");
    }
}
