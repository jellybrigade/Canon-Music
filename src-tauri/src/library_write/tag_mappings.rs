use super::LibraryWriteStore;
use rusqlite::{params, Connection, Transaction};

// TS `sqlNormExpression("raw_value")`: a spelling group's key, computed in SQL so a lookup meets
// the stored `norm_value`. `useTagMappings.writes.test.ts` keeps the two equal.
const RAW_VALUE_NORM: &str = "LOWER(REPLACE(REPLACE(TRIM(raw_value), '-', ' '), '_', ' '))";

const ACCEPTED: &str = "__accepted__";
const IGNORED: &str = "__ignored__";
const RAP: &str = "Rap";
const RAP_GROUP: &str = "rap";
const HIP_HOP: &str = "hip-hop";

fn refuse_if_group_locked(
    tx: &Transaction,
    raw_value: &str,
    kind: &str,
    norm: &str,
) -> Result<(), String> {
    let is_locked: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM tag_mappings WHERE norm_value = ? AND kind = ? AND locked = 1)",
            [norm, kind],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if is_locked {
        return Err(format!(
            "Mapping for \"{raw_value}\" is locked. Unlock it first."
        ));
    }
    Ok(())
}

fn set_group_track_tags(
    tx: &Transaction,
    kind: &str,
    norm: &str,
    canonical_id: Option<&str>,
) -> Result<(), String> {
    tx.execute(
        &format!("UPDATE track_tags SET canonical_id = ? WHERE {RAW_VALUE_NORM} = ? AND kind = ?"),
        params![canonical_id, norm, kind],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub(crate) struct TagMapping<'a> {
    pub(crate) raw_value: &'a str,
    pub(crate) kind: &'a str,
    pub(crate) norm: &'a str,
    pub(crate) canonical_id: &'a str,
    pub(crate) source: &'a str,
    pub(crate) match_type: Option<&'a str>,
}

/// One decision per spelling group: the saved spelling replaces every sibling's, and the
/// group's track tags follow it, all or nothing.
pub(crate) fn save_mapping(conn: &mut Connection, mapping: &TagMapping) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    refuse_if_group_locked(&tx, mapping.raw_value, mapping.kind, mapping.norm)?;
    tx.execute(
        "DELETE FROM tag_mappings WHERE norm_value = ? AND kind = ?",
        [mapping.norm, mapping.kind],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at, norm_value)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)",
        params![
            mapping.raw_value,
            mapping.kind,
            mapping.canonical_id,
            mapping.source,
            mapping.match_type,
            mapping.norm
        ],
    )
    .map_err(|e| e.to_string())?;
    // Sentinels never land in track_tags: only real canon ids go there.
    let track_tag_id = (mapping.canonical_id != ACCEPTED && mapping.canonical_id != IGNORED)
        .then_some(mapping.canonical_id);
    set_group_track_tags(&tx, mapping.kind, mapping.norm, track_tag_id)?;
    tx.commit().map_err(|e| e.to_string())
}

pub(crate) fn delete_mapping(
    conn: &mut Connection,
    raw_value: &str,
    kind: &str,
    norm: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    refuse_if_group_locked(&tx, raw_value, kind, norm)?;
    tx.execute(
        "DELETE FROM tag_mappings WHERE norm_value = ? AND kind = ?",
        [norm, kind],
    )
    .map_err(|e| e.to_string())?;
    set_group_track_tags(&tx, kind, norm, None)?;
    tx.commit().map_err(|e| e.to_string())
}

/// An automatic rule: it yields to a manual or locked decision on any spelling of Rap.
pub(crate) fn set_rap_rule(conn: &mut Connection, is_enabled: bool) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('tags.rap_to_hiphop', ?)",
        [if is_enabled { "true" } else { "false" }],
    )
    .map_err(|e| e.to_string())?;
    if is_enabled {
        let is_decided: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM tag_mappings WHERE norm_value = ? AND kind = 'genre'
                   AND (locked = 1 OR source = 'manual'))",
                [RAP_GROUP],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !is_decided {
            tx.execute(
                "DELETE FROM tag_mappings WHERE norm_value = ? AND kind = 'genre'",
                [RAP_GROUP],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at, norm_value)
                 VALUES (?, 'genre', ?, 'auto', 'exact', datetime('now'), ?)",
                [RAP, HIP_HOP, RAP_GROUP],
            )
            .map_err(|e| e.to_string())?;
            set_group_track_tags(&tx, "genre", RAP_GROUP, Some(HIP_HOP))?;
        }
    } else {
        let removed = tx
            .execute(
                "DELETE FROM tag_mappings WHERE norm_value = ? AND kind = 'genre' AND source = 'auto'
                   AND canonical_id = ? AND locked = 0",
                [RAP_GROUP, HIP_HOP],
            )
            .map_err(|e| e.to_string())?;
        if removed > 0 {
            tx.execute(
                &format!(
                    "UPDATE track_tags SET canonical_id = NULL
                     WHERE {RAW_VALUE_NORM} = ?1 AND kind = 'genre' AND canonical_id = ?2
                       AND NOT EXISTS (SELECT 1 FROM tag_mappings WHERE norm_value = ?1 AND kind = 'genre')"
                ),
                [RAP_GROUP, HIP_HOP],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri commands take their arguments flat.
pub fn save_tag_mapping(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    raw_value: String,
    kind: String,
    norm_value: String,
    canonical_id: String,
    source: String,
    match_type: Option<String>,
) -> Result<(), String> {
    state.with_conn(&app, |conn| {
        save_mapping(
            conn,
            &TagMapping {
                raw_value: &raw_value,
                kind: &kind,
                norm: &norm_value,
                canonical_id: &canonical_id,
                source: &source,
                match_type: match_type.as_deref(),
            },
        )
    })
}

#[tauri::command]
pub fn delete_tag_mapping(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    raw_value: String,
    kind: String,
    norm_value: String,
) -> Result<(), String> {
    state.with_conn(&app, |conn| {
        delete_mapping(conn, &raw_value, &kind, &norm_value)
    })
}

#[tauri::command]
pub fn set_rap_to_hip_hop(
    app: tauri::AppHandle,
    state: tauri::State<LibraryWriteStore>,
    enabled: bool,
) -> Result<(), String> {
    state.with_conn(&app, |conn| set_rap_rule(conn, enabled))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            "CREATE TABLE tag_mappings (
               raw_value TEXT NOT NULL, kind TEXT NOT NULL, canonical_id TEXT NOT NULL,
               source TEXT NOT NULL DEFAULT 'manual', match_type TEXT, created_at TEXT,
               locked INTEGER NOT NULL DEFAULT 0, norm_value TEXT,
               PRIMARY KEY (raw_value, kind)
             );
             CREATE TABLE track_tags (
               track_id TEXT NOT NULL, kind TEXT NOT NULL, raw_value TEXT NOT NULL,
               source TEXT NOT NULL, canonical_id TEXT
             );
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .expect("schema");
        conn
    }

    fn mapping(conn: &Connection, raw_value: &str, canonical_id: &str, norm: &str, locked: i64) {
        conn.execute(
            "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, locked, norm_value)
             VALUES (?, 'genre', ?, 'manual', ?, ?)",
            params![raw_value, canonical_id, locked, norm],
        )
        .expect("mapping");
    }

    fn tag_track(conn: &Connection, raw_value: &str, canonical_id: Option<&str>) {
        conn.execute(
            "INSERT INTO track_tags (track_id, kind, raw_value, source, canonical_id)
             VALUES ('t1', 'genre', ?, 'server', ?)",
            params![raw_value, canonical_id],
        )
        .expect("track tag");
    }

    fn rows(conn: &Connection) -> Vec<(String, String, i64)> {
        let mut stmt = conn
            .prepare("SELECT raw_value, canonical_id, locked FROM tag_mappings ORDER BY raw_value")
            .expect("prepare");
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows")
    }

    fn track_tag(conn: &Connection) -> Option<String> {
        conn.query_row("SELECT canonical_id FROM track_tags", [], |r| r.get(0))
            .expect("track tag")
    }

    fn save(
        conn: &mut Connection,
        raw_value: &str,
        norm: &str,
        canonical_id: &str,
    ) -> Result<(), String> {
        save_mapping(
            conn,
            &TagMapping {
                raw_value,
                kind: "genre",
                norm,
                canonical_id,
                source: "manual",
                match_type: None,
            },
        )
    }

    #[test]
    fn refuses_to_save_a_spelling_whose_sibling_spelling_is_locked() {
        let mut conn = fixture_conn();
        mapping(&conn, "hip hop", "hip-hop", "hip hop", 1);
        tag_track(&conn, "Hip-Hop", Some("hip-hop"));

        let error = save(&mut conn, "Hip-Hop", "hip hop", "rap").unwrap_err();

        assert!(error.contains("locked"));
        assert_eq!(rows(&conn), vec![("hip hop".into(), "hip-hop".into(), 1)]);
        assert_eq!(track_tag(&conn).as_deref(), Some("hip-hop"));
    }

    #[test]
    fn replaces_every_spelling_and_moves_the_groups_track_tags() {
        let mut conn = fixture_conn();
        mapping(&conn, "HIP_HOP", "rap", "hip hop", 0);
        mapping(&conn, "Rock", "rock", "rock", 0);
        tag_track(&conn, "HIP_HOP", Some("rap"));

        save(&mut conn, "Hip-Hop", "hip hop", "hip-hop").unwrap();

        assert_eq!(
            rows(&conn),
            vec![
                ("Hip-Hop".into(), "hip-hop".into(), 0),
                ("Rock".into(), "rock".into(), 0)
            ]
        );
        assert_eq!(track_tag(&conn).as_deref(), Some("hip-hop"));
    }

    #[test]
    fn a_failed_save_leaves_the_old_decision_alone() {
        let mut conn = fixture_conn();
        mapping(&conn, "HIP_HOP", "rap", "hip hop", 0);
        tag_track(&conn, "HIP_HOP", Some("rap"));
        conn.execute_batch(
            "CREATE TRIGGER refuse_track_tags BEFORE UPDATE ON track_tags BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();

        assert!(save(&mut conn, "Hip-Hop", "hip hop", "hip-hop").is_err());

        assert_eq!(rows(&conn), vec![("HIP_HOP".into(), "rap".into(), 0)]);
        assert_eq!(track_tag(&conn).as_deref(), Some("rap"));
    }

    #[test]
    fn an_accepted_or_ignored_decision_clears_the_track_tags() {
        let mut conn = fixture_conn();
        tag_track(&conn, "Noise", Some("noise"));

        save(&mut conn, "Noise", "noise", IGNORED).unwrap();

        assert_eq!(track_tag(&conn), None);
    }

    #[test]
    fn deleting_clears_every_spelling_and_leaves_other_groups_alone() {
        let mut conn = fixture_conn();
        mapping(&conn, "Jazz", "jazz", "jazz", 0);
        mapping(&conn, "JAZZ", "jazz", "jazz", 0);
        mapping(&conn, "Rock", "rock", "rock", 0);
        tag_track(&conn, "jazz", Some("jazz"));

        delete_mapping(&mut conn, "jazz", "genre", "jazz").unwrap();

        assert_eq!(rows(&conn), vec![("Rock".into(), "rock".into(), 0)]);
        assert_eq!(track_tag(&conn), None);
    }

    #[test]
    fn the_rap_rule_leaves_a_locked_or_manual_decision_alone() {
        let mut conn = fixture_conn();
        tag_track(&conn, "RAP", Some("trap"));
        mapping(&conn, "rap", "trap", "rap", 1);

        set_rap_rule(&mut conn, true).unwrap();
        assert_eq!(rows(&conn), vec![("rap".into(), "trap".into(), 1)]);
        set_rap_rule(&mut conn, false).unwrap();
        assert_eq!(rows(&conn), vec![("rap".into(), "trap".into(), 1)]);
        assert_eq!(track_tag(&conn).as_deref(), Some("trap"));
    }

    #[test]
    fn the_rap_rule_maps_every_spelling_while_on_and_clears_it_when_off() {
        let mut conn = fixture_conn();
        tag_track(&conn, "RAP", None);

        set_rap_rule(&mut conn, true).unwrap();
        assert_eq!(rows(&conn), vec![("Rap".into(), "hip-hop".into(), 0)]);
        assert_eq!(track_tag(&conn).as_deref(), Some("hip-hop"));

        set_rap_rule(&mut conn, false).unwrap();
        assert_eq!(rows(&conn), vec![]);
        assert_eq!(track_tag(&conn), None);
        let setting: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'tags.rap_to_hiphop'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(setting, "false");
    }
}
