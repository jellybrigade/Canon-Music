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

#[tauri::command]
pub fn delete_user_tree_node(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    id: String,
    name: String,
) -> Result<(), String> {
    state.with_conn(&app, |conn| delete_user_node(conn, &id, &name))
}

fn delete_user_node(conn: &mut Connection, id: &str, name: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let before = tx
        .query_row(
            "SELECT id, name, type, canonical_key, parent_ids FROM user_tree_nodes WHERE id = ?",
            [id],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "name": r.get::<_, String>(1)?,
                    "type": r.get::<_, String>(2)?,
                    "canonical_key": r.get::<_, String>(3)?,
                    "parent_ids": r.get::<_, String>(4)?,
                }))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Node not found.".to_string(),
            other => other.to_string(),
        })?;
    tx.execute(
        "INSERT INTO user_tree_changelog (node_id, node_name, action, before_json, after_json)
         VALUES (?, ?, 'delete', ?, NULL)",
        rusqlite::params![id, name, before.to_string()],
    )
    .map_err(|e| e.to_string())?;
    // Between these statements the tree still holds a node nothing maps to, and then tags
    // pointing at a node that is gone. Neither is a state the app can be started in.
    tx.execute("DELETE FROM tag_mappings WHERE canonical_id = ?", [id])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE track_tags SET canonical_id = NULL WHERE canonical_id = ?",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM album_user_genres WHERE canonical_id = ?", [id])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM album_genre_exclusions WHERE canonical_id = ?",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM album_genres WHERE canonical_id = ?", [id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM user_tree_nodes WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Tables whose rows are keyed to a track id and are carried when the server rewrites one.
///
/// Mirrors `remappedTrackIdTables()` in src/db/trackIdTables.ts, which is the source of truth;
/// src/db/trackIdTables.test.ts sweeps this list against it so the two cannot drift. `tracks`
/// itself is rewritten last, below, and `tracks_fts` is deliberately absent: the sync rebuilds it
/// from `tracks` for every album it touched, and deletes the row left under the old id while it
/// is there.
const REMAPPED_TRACK_ID_TABLES: &[(&str, &str)] = &[
    ("track_tags", "track_id"),
    ("loved_tracks", "track_id"),
    ("playlist_tracks", "track_id"),
    ("tag_issues", "track_id"),
    ("lyrics", "track_id"),
    ("waveform_cache", "track_id"),
    ("scrobble_queue", "track_id"),
    ("scrobble_history", "track_id"),
    ("playlist_resume", "last_track_id"),
];

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackIdRemap {
    pub old_id: String,
    pub new_id: String,
}

#[tauri::command]
pub fn remap_track_ids(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    remaps: Vec<TrackIdRemap>,
) -> Result<u32, String> {
    state.with_conn(&app, |conn| remap_track_ids_in(conn, &remaps))
}

/// Carry every row keyed to `old_id` onto `new_id`, then rewrite the track row itself.
///
/// One transaction because the intermediate states are not startable: a process dying between
/// two tables leaves the lyrics under the new id and the loved flag under the old one, and the
/// next sync prunes whichever half still carries the dead id. Returns how many track rows moved.
///
/// A destination id that somehow already holds a row is a collision this cannot resolve - keeping
/// both is impossible, and dropping the live one to make room is worse than leaving the stale row
/// for the prune to clear. That refusal is decided per track, before any table is touched:
/// `UPDATE OR IGNORE` declines only where a uniqueness constraint exists, and scrobble_queue and
/// playlist_resume have none on the track id, so leaving it to the statements would move the
/// user's listening history onto a track that kept its own id.
fn remap_track_ids_in(conn: &mut Connection, remaps: &[TrackIdRemap]) -> Result<u32, String> {
    if remaps.is_empty() {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut moved = 0u32;
    for remap in remaps {
        let destination_taken: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)",
                rusqlite::params![remap.new_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if destination_taken {
            continue;
        }
        for (table, column) in REMAPPED_TRACK_ID_TABLES {
            tx.execute(
                &format!("UPDATE OR IGNORE {table} SET {column} = ?2 WHERE {column} = ?1"),
                rusqlite::params![remap.old_id, remap.new_id],
            )
            .map_err(|e| e.to_string())?;
        }
        let rows = tx
            .execute(
                "UPDATE OR IGNORE tracks SET id = ?2 WHERE id = ?1",
                rusqlite::params![remap.old_id, remap.new_id],
            )
            .map_err(|e| e.to_string())?;
        moved += u32::try_from(rows).unwrap_or(0);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only the tables remap_track_ids_in writes. src/db/migrations.ts owns the real schema; the
    // load-bearing part here is that each one keys rows to a track id the server is free to
    // rewrite, and that loved_tracks makes it a PRIMARY KEY, which is what forces OR IGNORE.
    const REMAP_FIXTURE_DDL: &str = "
        CREATE TABLE tracks (id TEXT PRIMARY KEY, album_id TEXT, file_path TEXT);
        CREATE TABLE track_tags (track_id TEXT NOT NULL, kind TEXT, raw_value TEXT, source TEXT,
          UNIQUE(track_id, kind, raw_value, source));
        CREATE TABLE loved_tracks (track_id TEXT PRIMARY KEY);
        CREATE TABLE playlist_tracks (playlist_id TEXT NOT NULL, track_id TEXT NOT NULL,
          position INTEGER NOT NULL, PRIMARY KEY (playlist_id, position));
        CREATE TABLE tag_issues (track_id TEXT NOT NULL, issue_type TEXT,
          UNIQUE(track_id, issue_type));
        CREATE TABLE lyrics (track_id TEXT PRIMARY KEY, content TEXT);
        CREATE TABLE waveform_cache (track_id TEXT PRIMARY KEY, peaks_json TEXT);
        CREATE TABLE scrobble_queue (track_id TEXT NOT NULL, timestamp INTEGER);
        CREATE TABLE scrobble_history (track_id TEXT NOT NULL, timestamp INTEGER,
          UNIQUE(track_id, timestamp));
        CREATE TABLE playlist_resume (playlist_id TEXT PRIMARY KEY, last_track_id TEXT NOT NULL,
          track_position INTEGER NOT NULL);
    ";

    fn remap_fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(REMAP_FIXTURE_DDL).expect("ddl");
        conn
    }

    /// One track plus a row in every table keyed to it.
    fn seed_track(conn: &Connection, id: &str) {
        conn.execute_batch(&format!(
            "INSERT INTO tracks (id, album_id, file_path) VALUES ('{id}', 'alb', '/m/{id}.flac');
             INSERT INTO track_tags VALUES ('{id}', 'genre', 'Jazz', 'server');
             INSERT INTO loved_tracks VALUES ('{id}');
             INSERT INTO playlist_tracks VALUES ('p-{id}', '{id}', 0);
             INSERT INTO tag_issues VALUES ('{id}', 'missing-year');
             INSERT INTO lyrics VALUES ('{id}', 'words');
             INSERT INTO waveform_cache VALUES ('{id}', '[1,2]');
             INSERT INTO scrobble_queue VALUES ('{id}', 111);
             INSERT INTO scrobble_history VALUES ('{id}', 222);
             INSERT INTO playlist_resume VALUES ('p-{id}', '{id}', 30);"
        ))
        .expect("seed track");
    }

    fn rows_keyed_to(conn: &Connection, track_id: &str) -> Vec<String> {
        REMAPPED_TRACK_ID_TABLES
            .iter()
            .filter(|(table, column)| {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"),
                    [track_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("count")
                    > 0
            })
            .map(|(table, _)| (*table).to_string())
            .collect()
    }

    fn remap(old_id: &str, new_id: &str) -> TrackIdRemap {
        TrackIdRemap {
            old_id: old_id.to_string(),
            new_id: new_id.to_string(),
        }
    }

    #[test]
    fn carries_every_track_keyed_row_onto_the_new_id() {
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:old");

        let moved = remap_track_ids_in(&mut conn, &[remap("srv:old", "srv:new")]).expect("remap");

        assert_eq!(moved, 1);
        assert_eq!(rows_keyed_to(&conn, "srv:old"), Vec::<String>::new());
        assert_eq!(
            rows_keyed_to(&conn, "srv:new").len(),
            REMAPPED_TRACK_ID_TABLES.len()
        );
        let album: String = conn
            .query_row(
                "SELECT album_id FROM tracks WHERE id = ?",
                ["srv:new"],
                |r| r.get(0),
            )
            .expect("track row moved");
        assert_eq!(album, "alb");
    }

    #[test]
    fn leaves_every_other_track_alone() {
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:old");
        seed_track(&conn, "srv:other");

        remap_track_ids_in(&mut conn, &[remap("srv:old", "srv:new")]).expect("remap");

        assert_eq!(
            rows_keyed_to(&conn, "srv:other").len(),
            REMAPPED_TRACK_ID_TABLES.len()
        );
    }

    #[test]
    fn leaves_the_stale_row_behind_when_the_new_id_already_has_one() {
        // The destination is a real row the sync just wrote, so its own data wins and the
        // leftovers stay for the prune rather than being deleted to make room.
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:old");
        seed_track(&conn, "srv:new");

        let moved = remap_track_ids_in(&mut conn, &[remap("srv:old", "srv:new")]).expect("remap");

        assert_eq!(moved, 0);
        let old_still_there: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tracks WHERE id = ?",
                ["srv:old"],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(old_still_there, 1);
    }

    #[test]
    fn refuses_a_collision_for_every_table_at_once() {
        // `UPDATE OR IGNORE` only declines where a uniqueness constraint exists, so a table
        // that has none would hand the user's queued scrobble and resume position to whichever
        // track kept the id - a collision has to be all or nothing.
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:old");
        seed_track(&conn, "srv:new");

        remap_track_ids_in(&mut conn, &[remap("srv:old", "srv:new")]).expect("remap");

        for (table, column) in [
            ("scrobble_queue", "track_id"),
            ("scrobble_history", "track_id"),
            ("playlist_resume", "last_track_id"),
            ("track_tags", "track_id"),
        ] {
            let on_new: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"),
                    ["srv:new"],
                    |r| r.get(0),
                )
                .expect("count");
            assert_eq!(on_new, 1, "{table} kept only the destination's own row");
            let on_old: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"),
                    ["srv:old"],
                    |r| r.get(0),
                )
                .expect("count");
            assert_eq!(
                on_old, 1,
                "{table} left the stale row where the prune finds it"
            );
        }
    }

    #[test]
    fn carries_several_tracks_in_one_call() {
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:a");
        seed_track(&conn, "srv:b");

        let moved = remap_track_ids_in(
            &mut conn,
            &[remap("srv:a", "srv:a2"), remap("srv:b", "srv:b2")],
        )
        .expect("remap");

        assert_eq!(moved, 2);
        assert_eq!(
            rows_keyed_to(&conn, "srv:a2").len(),
            REMAPPED_TRACK_ID_TABLES.len()
        );
        assert_eq!(
            rows_keyed_to(&conn, "srv:b2").len(),
            REMAPPED_TRACK_ID_TABLES.len()
        );
    }

    #[test]
    fn writes_nothing_for_an_empty_list() {
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:old");

        assert_eq!(remap_track_ids_in(&mut conn, &[]).expect("remap"), 0);
        assert_eq!(
            rows_keyed_to(&conn, "srv:old").len(),
            REMAPPED_TRACK_ID_TABLES.len()
        );
    }

    #[test]
    fn rolls_back_every_table_when_one_statement_fails() {
        // Stands in for the process dying part way through: without the transaction the tables
        // updated before the failure would hold the new id and the rest the old one, and the
        // next prune would delete whichever half the mirror disagreed with.
        let mut conn = remap_fixture_conn();
        seed_track(&conn, "srv:old");
        conn.execute_batch(
            "CREATE TRIGGER block_resume BEFORE UPDATE ON playlist_resume
             BEGIN SELECT RAISE(ABORT, 'no'); END;",
        )
        .expect("trigger");

        let err = remap_track_ids_in(&mut conn, &[remap("srv:old", "srv:new")]).expect_err("fails");

        assert!(err.contains("no"), "unexpected error: {err}");
        assert_eq!(
            rows_keyed_to(&conn, "srv:old").len(),
            REMAPPED_TRACK_ID_TABLES.len()
        );
        assert_eq!(rows_keyed_to(&conn, "srv:new"), Vec::<String>::new());
    }

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

    const USER_TREE_FIXTURE_DDL: &str = "
        CREATE TABLE user_tree_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
          canonical_key TEXT NOT NULL, parent_ids TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE user_tree_changelog (id INTEGER PRIMARY KEY AUTOINCREMENT,
          node_id TEXT NOT NULL, node_name TEXT NOT NULL, action TEXT NOT NULL,
          before_json TEXT, after_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE tag_mappings (raw_value TEXT NOT NULL, kind TEXT NOT NULL,
          canonical_id TEXT NOT NULL, PRIMARY KEY (raw_value, kind));
        CREATE TABLE track_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL,
          kind TEXT NOT NULL, raw_value TEXT NOT NULL, canonical_id TEXT, source TEXT NOT NULL);
        CREATE TABLE album_user_genres (album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          name TEXT NOT NULL, PRIMARY KEY (album_id, canonical_id));
        CREATE TABLE album_genre_exclusions (album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          PRIMARY KEY (album_id, canonical_id));
        CREATE TABLE album_genres (album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          relation TEXT NOT NULL, section TEXT, name TEXT NOT NULL,
          PRIMARY KEY (album_id, canonical_id));
    ";

    fn user_tree_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(USER_TREE_FIXTURE_DDL).expect("ddl");
        conn.execute_batch(
            "INSERT INTO user_tree_nodes VALUES ('user:doom', 'Doom Jazz', 'genre', 'doom jazz', '[\"jazz\"]');
             INSERT INTO user_tree_nodes VALUES ('user:keep', 'Sludge', 'genre', 'sludge', '[]');
             INSERT INTO tag_mappings VALUES ('Doom-Jazz', 'genre', 'user:doom');
             INSERT INTO tag_mappings VALUES ('Sludgy', 'genre', 'user:keep');
             INSERT INTO track_tags VALUES (1, 't1', 'genre', 'Doom-Jazz', 'user:doom', 'server');
             INSERT INTO track_tags VALUES (2, 't2', 'genre', 'Sludgy', 'user:keep', 'server');
             INSERT INTO album_user_genres VALUES ('a1', 'user:doom', 'Doom Jazz');
             INSERT INTO album_user_genres VALUES ('a1', 'user:keep', 'Sludge');
             INSERT INTO album_genre_exclusions VALUES ('a2', 'user:doom');
             INSERT INTO album_genre_exclusions VALUES ('a2', 'user:keep');
             INSERT INTO album_genres VALUES ('a1', 'user:doom', 'direct', 'genres', 'Doom Jazz');
             INSERT INTO album_genres VALUES ('a1', 'user:keep', 'direct', 'genres', 'Sludge');",
        )
        .expect("seed");
        conn
    }

    fn scalar_count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).expect("count")
    }

    #[test]
    fn deleting_a_user_node_clears_the_mappings_and_tags_that_point_at_it() {
        let mut conn = user_tree_conn();

        delete_user_node(&mut conn, "user:doom", "Doom Jazz").expect("delete");

        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM user_tree_nodes WHERE id = 'user:doom'"
            ),
            0
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM tag_mappings WHERE canonical_id = 'user:doom'"
            ),
            0
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM track_tags WHERE canonical_id = 'user:doom'"
            ),
            0,
            "a tag pointing at a node that is gone must be left unresolved, not dangling"
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM track_tags WHERE canonical_id IS NULL"
            ),
            1
        );
    }

    #[test]
    fn deleting_a_user_node_clears_every_album_row_naming_it() {
        let mut conn = user_tree_conn();

        delete_user_node(&mut conn, "user:doom", "Doom Jazz").expect("delete");

        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM album_user_genres WHERE canonical_id = 'user:doom'"
            ),
            0,
            "an album genre naming a deleted node vanishes from normalization"
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM album_genre_exclusions WHERE canonical_id = 'user:doom'"
            ),
            0
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM album_genres WHERE canonical_id = 'user:doom'"
            ),
            0,
            "nothing re-normalizes the album, so a derived row would keep painting the dead genre"
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM album_genres WHERE canonical_id = 'user:keep'"
            ),
            1
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM album_user_genres WHERE canonical_id = 'user:keep'"
            ),
            1
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM album_genre_exclusions WHERE canonical_id = 'user:keep'"
            ),
            1
        );
    }

    #[test]
    fn deleting_a_user_node_leaves_every_other_node_untouched() {
        let mut conn = user_tree_conn();

        delete_user_node(&mut conn, "user:doom", "Doom Jazz").expect("delete");

        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM user_tree_nodes WHERE id = 'user:keep'"
            ),
            1
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM tag_mappings WHERE canonical_id = 'user:keep'"
            ),
            1
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM track_tags WHERE canonical_id = 'user:keep'"
            ),
            1
        );
    }

    #[test]
    fn deleting_a_user_node_records_the_row_it_removed() {
        let mut conn = user_tree_conn();

        delete_user_node(&mut conn, "user:doom", "Doom Jazz").expect("delete");

        let (action, name, before): (String, String, String) = conn
            .query_row(
                "SELECT action, node_name, before_json FROM user_tree_changelog WHERE node_id = ?",
                ["user:doom"],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("changelog row");
        assert_eq!(action, "delete");
        assert_eq!(name, "Doom Jazz");
        let parsed: serde_json::Value = serde_json::from_str(&before).expect("before_json");
        assert_eq!(parsed["id"], "user:doom");
        assert_eq!(parsed["name"], "Doom Jazz");
        assert_eq!(parsed["type"], "genre");
        assert_eq!(parsed["canonical_key"], "doom jazz");
        assert_eq!(parsed["parent_ids"], "[\"jazz\"]");
    }

    #[test]
    fn deleting_a_node_that_is_not_there_says_so_and_writes_nothing() {
        let mut conn = user_tree_conn();

        let err = delete_user_node(&mut conn, "user:gone", "Gone").expect_err("must fail");

        assert!(err.contains("Node not found"), "unexpected error: {err}");
        assert_eq!(
            scalar_count(&conn, "SELECT COUNT(*) FROM user_tree_changelog"),
            0
        );
    }

    #[test]
    fn a_failure_partway_through_leaves_the_node_and_its_mappings_intact() {
        // The reason this moved out of TypeScript: between the mapping delete and the node
        // delete the tree says the node exists while nothing maps to it, and a process dying
        // there strands every tag the node resolved with no way to get them back.
        let mut conn = user_tree_conn();
        conn.execute_batch(
            "CREATE TRIGGER fail_node_delete BEFORE DELETE ON user_tree_nodes
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .expect("trigger");

        let err = delete_user_node(&mut conn, "user:doom", "Doom Jazz").expect_err("must fail");
        assert!(err.contains("boom"), "original error must survive: {err}");

        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM tag_mappings WHERE canonical_id = 'user:doom'"
            ),
            1,
            "a failed delete must roll back to the state it started from"
        );
        assert_eq!(
            scalar_count(
                &conn,
                "SELECT COUNT(*) FROM track_tags WHERE canonical_id = 'user:doom'"
            ),
            1
        );
        assert_eq!(
            scalar_count(&conn, "SELECT COUNT(*) FROM user_tree_changelog"),
            0
        );
    }
}
