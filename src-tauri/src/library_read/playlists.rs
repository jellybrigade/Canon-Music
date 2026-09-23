use super::LibraryReadStore;
use rusqlite::Connection;
use serde::Serialize;
#[derive(Serialize)]
pub struct PlaylistRowDto {
    id: String,
    server_id: String,
    name: String,
    comment: Option<String>,
    track_count: i64,
    cover_art_url: Option<String>,
    custom_cover_data: Option<String>,
    is_smart: i64,
    rules_json: Option<String>,
}

#[tauri::command]
pub fn get_playlists(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<PlaylistRowDto>, String> {
    state.with_conn(&app, query_playlists)
}

fn query_playlists(conn: &Connection) -> Result<Vec<PlaylistRowDto>, String> {
    let sql = "SELECT id, server_id, name, comment, track_count, cover_art_url,
                custom_cover_data, is_smart, rules_json
         FROM playlists
         ORDER BY name ASC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlaylistRowDto {
                id: row.get(0)?,
                server_id: row.get(1)?,
                name: row.get(2)?,
                comment: row.get(3)?,
                track_count: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                cover_art_url: row.get(5)?,
                custom_cover_data: row.get(6)?,
                is_smart: row.get::<_, Option<i64>>(7)?.unwrap_or(0),
                rules_json: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_read::test_fixtures::*;

    #[test]
    fn each_playlist_row_reports_the_server_id_stored_on_that_row() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO playlists (id, server_id, name, track_count, is_smart) VALUES
               ('s1:p', 's1', 'Alpha', 3, 0),
               ('s2:p', 's2', 'Beta',  1, 0)",
        )
        .expect("seed");

        let rows = query_playlists(&conn).expect("query");
        let owners: Vec<(&str, &str)> = rows
            .iter()
            .map(|r| (r.id.as_str(), r.server_id.as_str()))
            .collect();
        assert_eq!(owners, [("s1:p", "s1"), ("s2:p", "s2")]);
    }

    #[test]
    fn a_playlist_with_null_track_count_or_is_smart_reads_as_zero() {
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO playlists (id, server_id, name, track_count, is_smart)
             VALUES ('s1:p', 's1', 'Legacy', NULL, NULL)",
            [],
        )
        .expect("seed");

        let rows = query_playlists(&conn).expect("query");
        assert_eq!(rows[0].track_count, 0);
        assert_eq!(rows[0].is_smart, 0);
    }

    #[test]
    fn canon_owned_playlist_columns_are_returned_alongside_the_server_owned_ones() {
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO playlists
               (id, server_id, name, comment, track_count, cover_art_url, custom_cover_data,
                is_smart, rules_json)
             VALUES ('s1:p','s1','Smart','note',4,'art://x','data:png',1,'{\"a\":1}')",
            [],
        )
        .expect("seed");

        let p = &query_playlists(&conn).expect("query")[0];
        assert_eq!(p.comment.as_deref(), Some("note"));
        assert_eq!(p.cover_art_url.as_deref(), Some("art://x"));
        assert_eq!(p.custom_cover_data.as_deref(), Some("data:png"));
        assert_eq!(p.is_smart, 1);
        assert_eq!(p.rules_json.as_deref(), Some("{\"a\":1}"));
    }
}
