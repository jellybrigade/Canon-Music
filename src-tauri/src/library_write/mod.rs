// Write counterpart to library_read/. Exists for one reason: a mutation whose
// intermediate states are invalid cannot be made atomic from TypeScript.
// tauri-plugin-sql runs every execute() through an sqlx pool (Pool::connect, default 10
// connections) with no connection affinity, so a "BEGIN" issued from TS is only really a
// transaction while nothing else queries concurrently - which src/db/migrations.ts can
// guarantee and a user-triggered playlist edit cannot (the 5-minute sync overlaps it).
// See known-issues.md, "A statement sequence whose intermediate states are invalid".
use rusqlite::{Connection, OpenFlags};
use std::sync::Mutex;
use std::time::Duration;

pub mod playlists;
pub mod track_remap;
pub mod user_tree;

#[derive(Default)]
pub struct LibraryWriteStore {
    conn: Mutex<Option<Connection>>,
}

impl LibraryWriteStore {
    fn with_conn<T>(
        &self,
        app: &tauri::AppHandle,
        f: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| "library write store lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(open_write_conn(app)?);
        }
        f(guard.as_mut().expect("just set"))
    }
}

fn open_write_conn(app: &tauri::AppHandle) -> Result<Connection, String> {
    open_write_conn_at(&crate::library_read::db_path(app)?)
}

fn open_write_conn_at(path: &std::path::Path) -> Result<Connection, String> {
    // CREATE deliberately omitted, same reasoning as open_read_conn_at: a misresolved path
    // must error rather than silently create an empty database beside the real one.
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| e.to_string())?;
    // The tauri-plugin-sql pool holds the write lock for the length of its own statements;
    // without a busy timeout a sync running at the same moment fails this command outright.
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}
