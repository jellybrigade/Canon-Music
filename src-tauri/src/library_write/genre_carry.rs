use super::LibraryWriteStore;
use rusqlite::{Connection, Transaction};
use std::collections::HashMap;

/// Columns holding one genre tree id per row.
///
/// Mirrors `GENRE_ID_HOLDERS` in src/db/genreIdTables.ts, which is the source of truth;
/// src/db/genreIdTables.test.ts sweeps these lists against it so the two cannot drift.
const GENRE_ID_COLUMNS: &[(&str, &str)] = &[
    ("tag_mappings", "canonical_id"),
    ("track_tags", "canonical_id"),
    ("album_genres", "canonical_id"),
    ("album_user_genres", "canonical_id"),
    ("album_genre_exclusions", "canonical_id"),
];

/// Display names stored beside the id, rewritten to the renamed node's name.
const GENRE_NAME_COLUMNS: &[(&str, &str)] =
    &[("album_genres", "name"), ("album_user_genres", "name")];

/// JSON columns holding a list of ids: `$` is a bare array, `$.selectedGenres` a field of an object.
const GENRE_ID_JSON_COLUMNS: &[(&str, &str, &str)] = &[
    ("user_tree_nodes", "parent_ids", "$"),
    ("playlists", "rules_json", "$.selectedGenres"),
];

const TREE_VERSION_KEY: &str = "genre_tree_version";

/// Stored in `canonical_id` columns but never tree nodes: decisions and unmatched raw tags.
const SENTINEL_IDS: &[&str] = &["__accepted__", "__ignored__"];
const RAW_ID_PREFIX: &str = "raw:";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreSeed {
    pub raw_value: String,
    pub kind: String,
    pub norm_value: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreIdRename {
    pub from: String,
    pub to: String,
    pub to_name: String,
    /// The old name, mapped by hand onto `to` because its key no longer resolves there.
    pub seed: Option<GenreSeed>,
}

#[tauri::command]
pub fn carry_genre_renames(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    renames: Vec<GenreIdRename>,
    tree_version: String,
) -> Result<(), String> {
    state.with_conn(&app, |conn| {
        carry_genre_renames_in(conn, &renames, &tree_version)
    })
}

/// Carry every stored reference to a renamed tree id onto its successor, then record the tree
/// version it was carried to.
///
/// One transaction, because a half-carried rename leaves an album's user genre under the new id
/// and its exclusion under the old one. The version is written last, inside it, so a failure
/// leaves the old version and the next launch carries again. Idempotent: over already-carried
/// data every statement matches nothing.
fn carry_genre_renames_in(
    conn: &mut Connection,
    renames: &[GenreIdRename],
    tree_version: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let froms: Vec<&str> = renames.iter().map(|r| r.from.as_str()).collect();
    mark_albums_for_renormalize(&tx, &froms)?;
    for rename in renames {
        carry_id_columns(&tx, rename)?;
        if let Some(seed) = &rename.seed {
            tx.execute(
                "INSERT OR IGNORE INTO tag_mappings (raw_value, kind, canonical_id, source, norm_value)
                 SELECT ?1, ?2, ?3, 'manual', ?4
                 WHERE NOT EXISTS (SELECT 1 FROM tag_mappings WHERE norm_value = ?4 AND kind = ?2)",
                rusqlite::params![seed.raw_value, seed.kind, rename.to, seed.norm_value],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let targets: HashMap<&str, Option<&str>> = renames
        .iter()
        .map(|r| (r.from.as_str(), Some(r.to.as_str())))
        .collect();
    for (table, column, path) in GENRE_ID_JSON_COLUMNS {
        carry_json_column(&tx, table, column, path, &targets)?;
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value != excluded.value",
        rusqlite::params![TREE_VERSION_KEY, tree_version],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct GenreRepairTarget {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn repair_dangling_genre_id(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    from: String,
    to: Option<GenreRepairTarget>,
) -> Result<(), String> {
    state.with_conn(&app, |conn| {
        repair_dangling_genre_id_in(conn, &from, to.as_ref())
    })
}

/// Moves every reference to an id no tree node carries onto `to`, or removes them all.
///
/// One transaction for the same reason as the carry. A removed mapping leaves its raw tag
/// unmapped rather than gone, so the tag returns to Review.
fn repair_dangling_genre_id_in(
    conn: &mut Connection,
    from: &str,
    to: Option<&GenreRepairTarget>,
) -> Result<(), String> {
    if SENTINEL_IDS.contains(&from) || from.starts_with(RAW_ID_PREFIX) {
        return Err(format!("\"{from}\" is not a genre tree id."));
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    mark_albums_for_renormalize(&tx, &[from])?;
    match to {
        Some(target) => carry_id_columns(
            &tx,
            &GenreIdRename {
                from: from.to_string(),
                to: target.id.clone(),
                to_name: target.name.clone(),
                seed: None,
            },
        )?,
        None => drop_id_columns(&tx, from)?,
    }
    let targets = HashMap::from([(from, to.map(|t| t.id.as_str()))]);
    for (table, column, path) in GENRE_ID_JSON_COLUMNS {
        carry_json_column(&tx, table, column, path, &targets)?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Albums touching a renamed id re-derive their genres against the new tree, and so do albums
/// holding a genre no node matched, since the new tree may match it now. Runs before the carry,
/// while the old ids are still there to find. Every `album_*` holder keys its rows by `album_id`.
fn mark_albums_for_renormalize(tx: &Transaction, froms: &[&str]) -> Result<(), String> {
    for from in froms {
        for (table, column) in GENRE_ID_COLUMNS
            .iter()
            .filter(|(t, _)| t.starts_with("album_"))
        {
            tx.execute(
                &format!(
                    "UPDATE albums SET computed_at = NULL WHERE computed_at IS NOT NULL
                       AND id IN (SELECT album_id FROM {table} WHERE {column} = ?1)"
                ),
                [from],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        "UPDATE albums SET computed_at = NULL WHERE computed_at IS NOT NULL
           AND id IN (SELECT album_id FROM album_unresolved_genres)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// `OR IGNORE` then delete: an album that already holds the new id keeps that row, and the row
/// under the old id would otherwise stay behind naming a node that is gone.
fn carry_id_columns(tx: &Transaction, rename: &GenreIdRename) -> Result<(), String> {
    for (table, column) in GENRE_ID_COLUMNS {
        let name_column = GENRE_NAME_COLUMNS
            .iter()
            .find(|(t, _)| t == table)
            .map(|(_, name)| *name);
        match name_column {
            Some(name) => tx.execute(
                &format!(
                    "UPDATE OR IGNORE {table} SET {column} = ?2, {name} = ?3 WHERE {column} = ?1"
                ),
                rusqlite::params![rename.from, rename.to, rename.to_name],
            ),
            None => tx.execute(
                &format!("UPDATE OR IGNORE {table} SET {column} = ?2 WHERE {column} = ?1"),
                rusqlite::params![rename.from, rename.to],
            ),
        }
        .map_err(|e| e.to_string())?;
        tx.execute(
            &format!("DELETE FROM {table} WHERE {column} = ?1"),
            [&rename.from],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `track_tags` rows are the tags themselves, so they lose only the id; every other holder is a
/// decision about that id and goes with it.
fn drop_id_columns(tx: &Transaction, from: &str) -> Result<(), String> {
    for (table, column) in GENRE_ID_COLUMNS {
        let sql = if *table == "track_tags" {
            format!("UPDATE {table} SET {column} = NULL WHERE {column} = ?1")
        } else {
            format!("DELETE FROM {table} WHERE {column} = ?1")
        };
        tx.execute(&sql, [from]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Rewrites only the id list at `path`, never a token elsewhere in the document: a smart
/// playlist named "punk" must keep its name. A value that does not parse is left alone.
fn carry_json_column(
    tx: &Transaction,
    table: &str,
    column: &str,
    path: &str,
    targets: &HashMap<&str, Option<&str>>,
) -> Result<(), String> {
    if targets.is_empty() {
        return Ok(());
    }
    let rows: Vec<(i64, String)> = {
        let mut stmt = tx
            .prepare(&format!(
                "SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?
    };
    for (rowid, raw) in rows {
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let list = match path.strip_prefix("$.") {
            Some(field) => value.get_mut(field),
            None => Some(&mut value),
        };
        let Some(serde_json::Value::Array(ids)) = list else {
            continue;
        };
        if !rename_in_list(ids, targets) {
            continue;
        }
        tx.execute(
            &format!("UPDATE {table} SET {column} = ?1 WHERE rowid = ?2"),
            rusqlite::params![value.to_string(), rowid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Renames in place (a `None` target removes the id) and drops a duplicate the rename created.
/// Returns whether anything changed.
fn rename_in_list(ids: &mut Vec<serde_json::Value>, targets: &HashMap<&str, Option<&str>>) -> bool {
    let mut changed = false;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids.drain(..) {
        let id = match id.as_str().and_then(|s| targets.get(s)) {
            Some(Some(to)) => {
                changed = true;
                serde_json::Value::String((*to).to_string())
            }
            Some(None) => {
                changed = true;
                continue;
            }
            None => id,
        };
        if seen.insert(id.to_string()) {
            out.push(id);
        } else {
            changed = true;
        }
    }
    *ids = out;
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only the tables the carry writes. src/db/migrations.ts owns the real schema; the
    // load-bearing parts are the (album_id, canonical_id) primary keys that force OR IGNORE.
    const CARRY_FIXTURE_DDL: &str = "
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE albums (id TEXT PRIMARY KEY, computed_at INTEGER);
        CREATE TABLE tag_mappings (raw_value TEXT NOT NULL, kind TEXT NOT NULL,
          canonical_id TEXT NOT NULL, source TEXT, norm_value TEXT, PRIMARY KEY (raw_value, kind));
        CREATE TABLE track_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL,
          kind TEXT NOT NULL, raw_value TEXT NOT NULL, canonical_id TEXT, source TEXT NOT NULL);
        CREATE TABLE album_genres (album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          relation TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (album_id, canonical_id));
        CREATE TABLE album_user_genres (album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          name TEXT NOT NULL, PRIMARY KEY (album_id, canonical_id));
        CREATE TABLE album_genre_exclusions (album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          PRIMARY KEY (album_id, canonical_id));
        CREATE TABLE album_unresolved_genres (album_id TEXT NOT NULL, raw_value TEXT NOT NULL);
        CREATE TABLE user_tree_nodes (id TEXT PRIMARY KEY, parent_ids TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE playlists (id TEXT PRIMARY KEY, rules_json TEXT);
    ";

    fn carry_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(CARRY_FIXTURE_DDL).expect("ddl");
        conn.execute_batch(
            "INSERT INTO albums VALUES ('a1', 100), ('a2', 100), ('a3', 100), ('a4', 100);
             INSERT INTO tag_mappings VALUES ('Punk Rock', 'genre', 'punk', 'manual', 'punk rock');
             INSERT INTO track_tags (track_id, kind, raw_value, canonical_id, source)
               VALUES ('t1', 'genre', 'Punk', 'punk', 'server');
             INSERT INTO album_genres VALUES ('a1', 'punk', 'direct', 'Punk'), ('a1', 'rock', 'direct', 'Rock');
             INSERT INTO album_user_genres VALUES ('a2', 'punk', 'Punk'), ('a2', 'hardcore', 'Hardcore');
             INSERT INTO album_genre_exclusions VALUES ('a3', 'punk');
             INSERT INTO album_unresolved_genres VALUES ('a4', 'Outrun');
             INSERT INTO user_tree_nodes VALUES ('user:skate', '[\"punk\",\"hardcore\"]');
             INSERT INTO playlists VALUES ('p1', '{\"name\":\"punk\",\"selectedGenres\":[\"punk\",\"rock\"]}');
             INSERT INTO playlists VALUES ('p2', 'not json');",
        )
        .expect("seed");
        conn
    }

    fn punk_rename(seed: bool) -> GenreIdRename {
        GenreIdRename {
            from: "punk".into(),
            to: "hardcore".into(),
            to_name: "Hardcore".into(),
            seed: seed.then(|| GenreSeed {
                raw_value: "Punk".into(),
                kind: "genre".into(),
                norm_value: "punk".into(),
            }),
        }
    }

    fn text(conn: &Connection, sql: &str) -> String {
        conn.query_row(sql, [], |r| r.get(0)).expect(sql)
    }

    fn texts(conn: &Connection, sql: &str) -> Vec<String> {
        let mut stmt = conn.prepare(sql).expect(sql);
        let rows = stmt.query_map([], |r| r.get(0)).expect(sql);
        rows.collect::<Result<_, _>>().expect(sql)
    }

    #[test]
    fn carries_every_id_column_onto_the_new_id() {
        let mut conn = carry_conn();
        carry_genre_renames_in(&mut conn, &[punk_rename(false)], "v2").expect("carry");

        for (table, column) in GENRE_ID_COLUMNS {
            let left: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = 'punk'"),
                    [],
                    |r| r.get(0),
                )
                .expect("count");
            assert_eq!(left, 0, "{table} still names the old id");
        }
        assert_eq!(
            text(&conn, "SELECT canonical_id FROM tag_mappings"),
            "hardcore"
        );
        assert_eq!(
            text(&conn, "SELECT canonical_id FROM track_tags"),
            "hardcore"
        );
        assert_eq!(
            texts(
                &conn,
                "SELECT canonical_id || ':' || name FROM album_genres ORDER BY canonical_id"
            ),
            vec!["hardcore:Hardcore", "rock:Rock"]
        );
        assert_eq!(
            text(&conn, "SELECT canonical_id FROM album_genre_exclusions"),
            "hardcore"
        );
    }

    #[test]
    fn keeps_one_row_when_the_album_already_holds_the_new_id() {
        let mut conn = carry_conn();
        carry_genre_renames_in(&mut conn, &[punk_rename(false)], "v2").expect("carry");
        assert_eq!(
            texts(
                &conn,
                "SELECT canonical_id || ':' || name FROM album_user_genres"
            ),
            vec!["hardcore:Hardcore"]
        );
    }

    #[test]
    fn rewrites_only_the_id_lists_inside_json() {
        let mut conn = carry_conn();
        carry_genre_renames_in(&mut conn, &[punk_rename(false)], "v2").expect("carry");
        assert_eq!(
            text(&conn, "SELECT parent_ids FROM user_tree_nodes"),
            "[\"hardcore\"]"
        );
        assert_eq!(
            text(&conn, "SELECT rules_json FROM playlists WHERE id = 'p1'"),
            "{\"name\":\"punk\",\"selectedGenres\":[\"hardcore\",\"rock\"]}"
        );
        assert_eq!(
            text(&conn, "SELECT rules_json FROM playlists WHERE id = 'p2'"),
            "not json"
        );
    }

    #[test]
    fn marks_touched_and_unresolved_albums_for_renormalize() {
        let mut conn = carry_conn();
        conn.execute("INSERT INTO albums VALUES ('a5', 100)", [])
            .expect("album");
        carry_genre_renames_in(&mut conn, &[punk_rename(false)], "v2").expect("carry");
        assert_eq!(
            texts(
                &conn,
                "SELECT id FROM albums WHERE computed_at IS NULL ORDER BY id"
            ),
            vec!["a1", "a2", "a3", "a4"]
        );
    }

    #[test]
    fn seeds_the_old_name_unless_its_norm_is_already_mapped() {
        let mut conn = carry_conn();
        carry_genre_renames_in(&mut conn, &[punk_rename(true)], "v2").expect("carry");
        assert_eq!(
            texts(&conn, "SELECT raw_value || ':' || canonical_id || ':' || source FROM tag_mappings ORDER BY raw_value"),
            vec!["Punk:hardcore:manual", "Punk Rock:hardcore:manual"]
        );

        let mut mapped = carry_conn();
        mapped
            .execute(
                "INSERT INTO tag_mappings VALUES ('PUNK', 'genre', 'rock', 'manual', 'punk')",
                [],
            )
            .expect("mapping");
        carry_genre_renames_in(&mut mapped, &[punk_rename(true)], "v2").expect("carry");
        assert_eq!(
            text(
                &mapped,
                "SELECT canonical_id FROM tag_mappings WHERE norm_value = 'punk'"
            ),
            "rock"
        );
    }

    #[test]
    fn records_the_tree_version() {
        let mut conn = carry_conn();
        carry_genre_renames_in(&mut conn, &[], "v2").expect("carry");
        assert_eq!(
            text(
                &conn,
                "SELECT value FROM settings WHERE key = 'genre_tree_version'"
            ),
            "v2"
        );
    }

    #[test]
    fn a_second_run_over_carried_data_writes_nothing() {
        let mut conn = carry_conn();
        carry_genre_renames_in(&mut conn, &[punk_rename(true)], "v2").expect("carry");
        let before = conn.total_changes();
        carry_genre_renames_in(&mut conn, &[punk_rename(true)], "v2").expect("carry again");
        assert_eq!(conn.total_changes() - before, 0);
    }

    #[test]
    fn a_failure_rolls_back_every_table_and_leaves_the_old_version() {
        let mut conn = carry_conn();
        conn.execute_batch(
            "INSERT INTO settings VALUES ('genre_tree_version', 'v1');
             CREATE TRIGGER refuse BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .expect("trigger");
        let err =
            carry_genre_renames_in(&mut conn, &[punk_rename(true)], "v2").expect_err("must fail");
        assert!(err.contains("refused"), "{err}");
        assert_eq!(text(&conn, "SELECT canonical_id FROM tag_mappings"), "punk");
        assert_eq!(
            text(&conn, "SELECT parent_ids FROM user_tree_nodes"),
            "[\"punk\",\"hardcore\"]"
        );
        assert_eq!(text(&conn, "SELECT value FROM settings"), "v1");
        let nulled: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM albums WHERE computed_at IS NULL",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(nulled, 0);
    }

    fn target(id: &str, name: &str) -> GenreRepairTarget {
        GenreRepairTarget {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn repair_remaps_a_dangling_id_everywhere_without_touching_the_tree_version() {
        let mut conn = carry_conn();
        repair_dangling_genre_id_in(&mut conn, "punk", Some(&target("hardcore", "Hardcore")))
            .expect("repair");
        assert_eq!(
            text(&conn, "SELECT canonical_id FROM tag_mappings"),
            "hardcore"
        );
        assert_eq!(
            texts(
                &conn,
                "SELECT canonical_id || ':' || name FROM album_user_genres"
            ),
            vec!["hardcore:Hardcore"]
        );
        assert_eq!(
            text(&conn, "SELECT parent_ids FROM user_tree_nodes"),
            "[\"hardcore\"]"
        );
        let versions: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .expect("count");
        assert_eq!(versions, 0);
    }

    #[test]
    fn repair_without_a_target_removes_every_reference() {
        let mut conn = carry_conn();
        repair_dangling_genre_id_in(&mut conn, "punk", None).expect("repair");
        for (table, column) in GENRE_ID_COLUMNS {
            let left: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = 'punk'"),
                    [],
                    |r| r.get(0),
                )
                .expect("count");
            assert_eq!(left, 0, "{table} still names the removed id");
        }
        // The raw tag row stays, only unmapped, so it returns to Review.
        assert_eq!(
            texts(
                &conn,
                "SELECT raw_value FROM track_tags WHERE canonical_id IS NULL"
            ),
            vec!["Punk"]
        );
        assert_eq!(
            texts(&conn, "SELECT canonical_id FROM album_genres"),
            vec!["rock"]
        );
        assert_eq!(
            text(&conn, "SELECT parent_ids FROM user_tree_nodes"),
            "[\"hardcore\"]"
        );
        assert_eq!(
            text(&conn, "SELECT rules_json FROM playlists WHERE id = 'p1'"),
            "{\"name\":\"punk\",\"selectedGenres\":[\"rock\"]}"
        );
        assert_eq!(
            texts(
                &conn,
                "SELECT id FROM albums WHERE computed_at IS NULL ORDER BY id"
            ),
            vec!["a1", "a2", "a3", "a4"]
        );
    }

    #[test]
    fn repair_refuses_a_sentinel_and_writes_nothing() {
        let mut conn = carry_conn();
        let before = conn.total_changes();
        for sentinel in ["__accepted__", "__ignored__", "raw:outrun"] {
            assert!(repair_dangling_genre_id_in(&mut conn, sentinel, None).is_err());
        }
        assert_eq!(conn.total_changes() - before, 0);
    }
}
