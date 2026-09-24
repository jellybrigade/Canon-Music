use super::LibraryWriteStore;
use rusqlite::Connection;
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

#[cfg(test)]
mod tests {
    use super::*;

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
