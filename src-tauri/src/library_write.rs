// Write counterpart to library_read.rs. Exists for one reason: a mutation whose
// intermediate states are invalid cannot be made atomic from TypeScript.
// tauri-plugin-sql runs every execute() through an sqlx pool (Pool::connect, default 10
// connections) with no connection affinity, so a "BEGIN" issued from TS is only really a
// transaction while nothing else queries concurrently - which src/db/migrations.ts can
// guarantee and a user-triggered playlist edit cannot (the 5-minute sync overlaps it).
// See known-issues.md, "A statement sequence whose intermediate states are invalid".
use rusqlite::{Connection, OpenFlags};
use std::sync::Mutex;
use std::time::Duration;

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

#[tauri::command]
pub fn playlist_remove_track(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    playlist_id: String,
    position: i64,
) -> Result<(), String> {
    state.with_conn(&app, |conn| {
        remove_playlist_track(conn, &playlist_id, position)
    })
}

fn remove_playlist_track(
    conn: &mut Connection,
    playlist_id: &str,
    position: i64,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?",
        rusqlite::params![playlist_id, position],
    )
    .map_err(|e| e.to_string())?;
    // Close the hole the delete left. `position` doubles as the server's
    // songIndexToRemove (see the call in PlaylistDetail), and the server compacts its own
    // indexes on removal, so leaving a gap means the next removal in the same session
    // sends a stale index and deletes the wrong track server side. It is also what the row
    // numbering renders, so a gap shows up as 1, 2, 4.
    //
    // Two passes through negative space because PRIMARY KEY (playlist_id, position) is
    // enforced per row: a single in-place decrement collides with the row still holding the
    // target position whenever SQLite happens to scan descending. That negative window is
    // exactly why this lives in one transaction - a process killed between the passes would
    // otherwise leave rows at negative positions that nothing ever repairs.
    tx.execute(
        "UPDATE playlist_tracks SET position = -(position - 1) WHERE playlist_id = ? AND position > ?",
        rusqlite::params![playlist_id, position],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE playlist_tracks SET position = -position WHERE playlist_id = ? AND position < 0",
        [playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE playlists SET track_count = MAX(0, track_count - 1) WHERE id = ?",
        [playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only the two tables this command writes. src/db/migrations.ts owns the real schema;
    // the PRIMARY KEY (playlist_id, position) is the load-bearing part - it is what forces
    // the compaction through negative space rather than a single in-place decrement.
    const FIXTURE_DDL: &str = "
        CREATE TABLE playlists (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          track_count INTEGER
        );
        CREATE TABLE playlist_tracks (
          playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL,
          PRIMARY KEY (playlist_id, position)
        );
    ";

    fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(FIXTURE_DDL).expect("ddl");
        conn
    }

    fn seed_playlist(conn: &Connection, id: &str, server_id: &str, track_ids: &[&str]) {
        conn.execute(
            "INSERT INTO playlists (id, server_id, name, track_count) VALUES (?, ?, ?, ?)",
            rusqlite::params![id, server_id, id, track_ids.len() as i64],
        )
        .expect("seed playlist");
        for (position, track_id) in track_ids.iter().enumerate() {
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
                rusqlite::params![id, track_id, position as i64],
            )
            .expect("seed playlist track");
        }
    }

    fn rows_of(conn: &Connection, playlist_id: &str) -> Vec<(i64, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT position, track_id FROM playlist_tracks
                 WHERE playlist_id = ? ORDER BY position ASC",
            )
            .expect("prepare");
        let rows = stmt
            .query_map([playlist_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .collect::<rusqlite::Result<Vec<(i64, String)>>>()
            .expect("collect");
        rows
    }

    fn track_count_of(conn: &Connection, playlist_id: &str) -> i64 {
        conn.query_row(
            "SELECT track_count FROM playlists WHERE id = ?",
            [playlist_id],
            |row| row.get(0),
        )
        .expect("track_count")
    }

    #[test]
    fn removing_a_middle_track_closes_the_hole_it_left() {
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a", "b", "c", "d"]);

        remove_playlist_track(&mut conn, "srv-a:p", 1).expect("remove");

        assert_eq!(
            rows_of(&conn, "srv-a:p"),
            [
                (0, "a".to_string()),
                (1, "c".to_string()),
                (2, "d".to_string())
            ]
        );
        assert_eq!(track_count_of(&conn, "srv-a:p"), 3);
    }

    #[test]
    fn removing_position_zero_compacts_the_row_that_lands_on_negative_zero() {
        // The negative-space pass maps position 1 to -(1-1) = 0, which is not negative, so
        // the second pass skips it. Correct only because position 0 was just deleted; if
        // positions ever become 1-based this breaks silently.
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a", "b", "c"]);

        remove_playlist_track(&mut conn, "srv-a:p", 0).expect("remove");

        assert_eq!(
            rows_of(&conn, "srv-a:p"),
            [(0, "b".to_string()), (1, "c".to_string())]
        );
    }

    #[test]
    fn removing_the_last_track_leaves_the_survivors_alone() {
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a", "b", "c"]);

        remove_playlist_track(&mut conn, "srv-a:p", 2).expect("remove");

        assert_eq!(
            rows_of(&conn, "srv-a:p"),
            [(0, "a".to_string()), (1, "b".to_string())]
        );
    }

    #[test]
    fn removing_the_only_track_empties_the_playlist() {
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a"]);

        remove_playlist_track(&mut conn, "srv-a:p", 0).expect("remove");

        assert!(rows_of(&conn, "srv-a:p").is_empty());
        assert_eq!(track_count_of(&conn, "srv-a:p"), 0);
    }

    #[test]
    fn a_pre_existing_hole_is_healed_rather_than_preserved() {
        let mut conn = fixture_conn();
        conn.execute(
            "INSERT INTO playlists (id, server_id, name, track_count) VALUES ('srv-a:p','srv-a','p',3)",
            [],
        )
        .expect("seed");
        for (track_id, position) in [("a", 0), ("c", 2), ("d", 3)] {
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('srv-a:p', ?, ?)",
                rusqlite::params![track_id, position],
            )
            .expect("seed row");
        }

        remove_playlist_track(&mut conn, "srv-a:p", 1).expect("remove");

        assert_eq!(
            rows_of(&conn, "srv-a:p"),
            [
                (0, "a".to_string()),
                (1, "c".to_string()),
                (2, "d".to_string())
            ]
        );
    }

    #[test]
    fn a_long_playlist_compacts_without_hitting_the_position_primary_key() {
        // The two negative-space passes exist because a single in-place decrement collides
        // with the row still holding the target position whenever SQLite scans descending.
        let mut conn = fixture_conn();
        let ids: Vec<String> = (0..200).map(|i| format!("t{i}")).collect();
        let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        seed_playlist(&conn, "srv-a:p", "srv-a", &refs);

        remove_playlist_track(&mut conn, "srv-a:p", 0).expect("remove");

        let rows = rows_of(&conn, "srv-a:p");
        assert_eq!(rows.len(), 199);
        assert_eq!(
            rows.iter().map(|r| r.0).collect::<Vec<i64>>(),
            (0..199).collect::<Vec<i64>>()
        );
        assert_eq!(rows[0].1, "t1");
    }

    #[test]
    fn another_playlist_is_untouched() {
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a", "b", "c"]);
        seed_playlist(&conn, "srv-b:p", "srv-b", &["x", "y", "z"]);

        remove_playlist_track(&mut conn, "srv-a:p", 0).expect("remove");

        assert_eq!(
            rows_of(&conn, "srv-b:p"),
            [
                (0, "x".to_string()),
                (1, "y".to_string()),
                (2, "z".to_string())
            ]
        );
        assert_eq!(track_count_of(&conn, "srv-b:p"), 3);
    }

    #[test]
    fn track_count_clamps_at_zero_rather_than_going_negative() {
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &[]);

        remove_playlist_track(&mut conn, "srv-a:p", 0).expect("remove");

        assert_eq!(track_count_of(&conn, "srv-a:p"), 0);
    }

    #[test]
    fn a_position_that_does_not_exist_still_decrements_the_count() {
        // Pinned deliberately: the DELETE matches nothing but the count still moves. The
        // server was told to remove that index too, so a mismatch is a symptom of the
        // caller. Flip this if track_count ever becomes derived.
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a", "b"]);

        remove_playlist_track(&mut conn, "srv-a:p", 9).expect("remove");

        assert_eq!(rows_of(&conn, "srv-a:p").len(), 2);
        assert_eq!(track_count_of(&conn, "srv-a:p"), 1);
    }

    #[test]
    fn a_failure_partway_through_leaves_no_row_at_a_negative_position() {
        // The whole point of the command. A trigger that rejects the second compaction pass
        // stands in for the process dying between the two: without the transaction the rows
        // stay negative forever and nothing repairs them.
        let mut conn = fixture_conn();
        seed_playlist(&conn, "srv-a:p", "srv-a", &["a", "b", "c", "d"]);
        conn.execute_batch(
            "CREATE TRIGGER fail_second_pass BEFORE UPDATE ON playlist_tracks
             WHEN OLD.position < 0
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .expect("trigger");

        let err = remove_playlist_track(&mut conn, "srv-a:p", 1).expect_err("must fail");
        assert!(err.contains("boom"), "original error must survive: {err}");

        assert_eq!(
            rows_of(&conn, "srv-a:p"),
            [
                (0, "a".to_string()),
                (1, "b".to_string()),
                (2, "c".to_string()),
                (3, "d".to_string())
            ],
            "a failed removal must roll back to the state it started from"
        );
        assert_eq!(track_count_of(&conn, "srv-a:p"), 4);
    }
}
