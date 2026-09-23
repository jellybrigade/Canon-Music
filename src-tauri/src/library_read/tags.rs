use super::LibraryReadStore;
use rusqlite::Connection;
// Scalar replacement for the full useTagVocab payload at app root, which existed only
// to compute this badge number. Reproduces the JS predicate exactly:
// !canonical_id && album_count > 0. The UNION ALL arm of the vocab query always has
// album_count = 0, so it can never satisfy the predicate and is dropped here.
#[tauri::command]
pub fn get_unmapped_tag_count(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<i64, String> {
    state.with_conn(&app, query_unmapped_tag_count)
}

fn query_unmapped_tag_count(conn: &Connection) -> Result<i64, String> {
    let sql = "SELECT COUNT(*) AS n
         FROM tag_vocab_cache c
         LEFT JOIN (
           SELECT norm_value, kind, canonical_id
           FROM tag_mappings
           GROUP BY norm_value, kind
         ) tm ON tm.norm_value = c.norm_value AND tm.kind = c.kind
         WHERE c.album_count > 0 AND tm.canonical_id IS NULL";
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_read::test_fixtures::*;

    fn insert_vocab(conn: &Connection, norm: &str, kind: &str, album_count: i64) {
        conn.execute(
            "INSERT INTO tag_vocab_cache (norm_value, raw_value, kind, album_count)
             VALUES (?, ?, ?, ?)",
            rusqlite::params![norm, norm, kind, album_count],
        )
        .expect("insert vocab");
    }

    #[test]
    fn only_vocab_entries_with_albums_and_without_a_mapping_are_counted() {
        let conn = fixture_conn();
        insert_vocab(&conn, "shoegaze", "genre", 3);
        insert_vocab(&conn, "mapped", "genre", 2);
        conn.execute(
            "INSERT INTO tag_mappings (raw_value, kind, canonical_id, norm_value)
             VALUES ('Mapped', 'genre', 'rock', 'mapped')",
            [],
        )
        .expect("seed mapping");

        assert_eq!(query_unmapped_tag_count(&conn).expect("query"), 1);
    }

    #[test]
    fn a_vocab_entry_on_zero_albums_is_not_counted_but_one_album_is() {
        let conn = fixture_conn();
        insert_vocab(&conn, "zero", "genre", 0);
        assert_eq!(query_unmapped_tag_count(&conn).expect("query"), 0);

        insert_vocab(&conn, "one", "genre", 1);
        assert_eq!(query_unmapped_tag_count(&conn).expect("query"), 1);
    }

    #[test]
    fn a_legacy_mapping_with_no_norm_value_cannot_mark_its_vocab_entry_mapped() {
        // norm_value arrived by ALTER in migration 27 and is nullable; rows written
        // before it never join, so their tag still reads as unmapped.
        let conn = fixture_conn();
        insert_vocab(&conn, "shoegaze", "genre", 3);
        conn.execute(
            "INSERT INTO tag_mappings (raw_value, kind, canonical_id, norm_value)
             VALUES ('Shoegaze', 'genre', 'rock', NULL)",
            [],
        )
        .expect("seed mapping");

        assert_eq!(query_unmapped_tag_count(&conn).expect("query"), 1);
    }

    #[test]
    fn mappings_are_matched_on_kind_as_well_as_value() {
        let conn = fixture_conn();
        insert_vocab(&conn, "dark", "mood", 2);
        conn.execute(
            "INSERT INTO tag_mappings (raw_value, kind, canonical_id, norm_value)
             VALUES ('Dark', 'genre', 'rock', 'dark')",
            [],
        )
        .expect("seed mapping");

        assert_eq!(
            query_unmapped_tag_count(&conn).expect("query"),
            1,
            "a genre mapping must not satisfy a mood vocab entry"
        );
    }

    #[test]
    fn an_empty_vocab_counts_zero_rather_than_erroring() {
        let conn = fixture_conn();
        assert_eq!(query_unmapped_tag_count(&conn).expect("query"), 0);
    }
}
