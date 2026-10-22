use super::LibraryWriteStore;
use rusqlite::{Connection, OptionalExtension};

#[tauri::command]
pub fn merge_artist(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    alias_name: String,
    canonical_name: String,
) -> Result<(), String> {
    state.with_conn(&app, |conn| {
        merge_artist_into(conn, &alias_name, &canonical_name)
    })
}

// Every alias read follows one hop, so a merge keeps the table flat: the target resolves to the
// artist it points at, and the merged artist's own aliases follow it there.
fn merge_artist_into(
    conn: &mut Connection,
    alias_name: &str,
    canonical_name: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let target: String = tx
        .query_row(
            "SELECT canonical_name FROM artist_aliases WHERE alias_name = ?",
            [canonical_name],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| canonical_name.to_string());
    if target == alias_name {
        return Err(format!(
            "{alias_name} can't be merged into {canonical_name}, which is already merged into it"
        ));
    }
    tx.execute(
        "UPDATE artist_aliases SET canonical_name = ? WHERE canonical_name = ?",
        [&target, alias_name],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO artist_aliases (alias_name, canonical_name) VALUES (?, ?)",
        [alias_name, &target],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            "CREATE TABLE artist_aliases (
               alias_name TEXT NOT NULL PRIMARY KEY, canonical_name TEXT NOT NULL
             );",
        )
        .expect("ddl");
        conn
    }

    fn aliases(conn: &Connection) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare("SELECT alias_name, canonical_name FROM artist_aliases ORDER BY alias_name")
            .expect("prepare");
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows")
    }

    fn pair(alias: &str, canonical: &str) -> (String, String) {
        (alias.to_string(), canonical.to_string())
    }

    #[test]
    fn merging_an_artist_moves_its_own_aliases_along_with_it() {
        let mut conn = fixture_conn();
        merge_artist_into(&mut conn, "Ye", "Kanye").expect("first merge");
        merge_artist_into(&mut conn, "Kanye", "Kanye West").expect("second merge");

        assert_eq!(
            aliases(&conn),
            [pair("Kanye", "Kanye West"), pair("Ye", "Kanye West")]
        );
    }

    #[test]
    fn merging_into_an_alias_lands_on_the_artist_it_points_at() {
        let mut conn = fixture_conn();
        merge_artist_into(&mut conn, "Ye", "Kanye West").expect("first merge");
        merge_artist_into(&mut conn, "Yeezy", "Ye").expect("second merge");

        assert_eq!(
            aliases(&conn),
            [pair("Ye", "Kanye West"), pair("Yeezy", "Kanye West")]
        );
    }

    #[test]
    fn an_artist_cannot_be_merged_into_its_own_alias() {
        let mut conn = fixture_conn();
        merge_artist_into(&mut conn, "Ye", "Kanye West").expect("first merge");

        assert!(merge_artist_into(&mut conn, "Kanye West", "Ye").is_err());
        assert_eq!(aliases(&conn), [pair("Ye", "Kanye West")]);
    }
}
