use super::LibraryWriteStore;
use rusqlite::Connection;
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
}
