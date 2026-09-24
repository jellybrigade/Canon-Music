use super::LibraryReadStore;
use rusqlite::Connection;
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LovedDto {
    track_ids: Vec<String>,
    album_ids: Vec<String>,
    track_album_ids: Vec<String>,
}

// All three loved-id sets in one round trip. useLoved is mounted by ~8 components at
// once, so the previous shape (3 sqlx selects per call site) multiplied badly.
#[tauri::command]
pub fn get_loved(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<LovedDto, String> {
    state.with_conn(&app, query_loved)
}

fn query_loved(conn: &Connection) -> Result<LovedDto, String> {
    let collect_ids = |sql: &str| -> Result<Vec<String>, String> {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    };
    Ok(LovedDto {
        track_ids: collect_ids("SELECT track_id FROM loved_tracks")?,
        album_ids: collect_ids("SELECT album_id FROM loved_albums")?,
        track_album_ids: collect_ids(
            "SELECT DISTINCT t.album_id FROM tracks t
             INNER JOIN loved_tracks lt ON lt.track_id = t.id
             WHERE t.album_id IS NOT NULL",
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_read::test_fixtures::*;

    #[test]
    fn loved_returns_track_ids_album_ids_and_the_albums_reachable_from_loved_tracks() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO tracks (id, server_id, title, album_id) VALUES
               ('s1:t1', 's1', 'A', 's1:al1'),
               ('s1:t2', 's1', 'B', 's1:al1'),
               ('s1:t3', 's1', 'C', NULL);
             INSERT INTO loved_tracks (track_id) VALUES ('s1:t1'), ('s1:t2'), ('s1:t3');
             INSERT INTO loved_albums (album_id) VALUES ('s1:al9')",
        )
        .expect("seed");

        let loved = query_loved(&conn).expect("query");
        assert_eq!(loved.track_ids.len(), 3);
        assert_eq!(loved.album_ids, ["s1:al9"]);
        assert_eq!(
            loved.track_album_ids,
            ["s1:al1"],
            "DISTINCT collapses the two tracks; the NULL album_id track is excluded"
        );
    }

    #[test]
    fn loved_is_empty_rather_than_erroring_on_an_untouched_library() {
        let conn = fixture_conn();
        let loved = query_loved(&conn).expect("query");
        assert!(loved.track_ids.is_empty());
        assert!(loved.album_ids.is_empty());
        assert!(loved.track_album_ids.is_empty());
    }

    #[test]
    fn a_loved_track_that_no_longer_exists_contributes_no_album() {
        let conn = fixture_conn();
        conn.execute("INSERT INTO loved_tracks (track_id) VALUES ('s1:gone')", [])
            .expect("seed");

        let loved = query_loved(&conn).expect("query");
        assert_eq!(loved.track_ids, ["s1:gone"]);
        assert!(loved.track_album_ids.is_empty());
    }
}
