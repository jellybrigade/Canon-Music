use super::LibraryReadStore;
use rusqlite::Connection;
use serde::Serialize;
#[derive(Serialize)]
pub struct AlbumRowDto {
    id: String,
    server_id: String,
    name: String,
    artist: Option<String>,
    year: Option<i64>,
    artwork_url: Option<String>,
    release_type: Option<String>,
    accent_color: Option<String>,
}

// Mirrors the AlbumSort union in src/types/library.ts (and the runtime whitelist in
// src/App.tsx) - kept as a server-side allowlist since `sort` crosses the JS/Rust
// boundary as a plain string.
fn order_by_clause(sort: &str) -> Result<&'static str, String> {
    match sort {
        "artist" => Ok("a.artist COLLATE NOCASE, a.name COLLATE NOCASE"),
        "alphabetical" => Ok("a.name COLLATE NOCASE"),
        "year" => Ok("a.year DESC, a.name COLLATE NOCASE"),
        "recently_added" => Ok("COALESCE(a.navidrome_created, a.created_at) DESC"),
        other => Err(format!("unknown album sort: {other}")),
    }
}

#[tauri::command]
pub fn get_albums(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
    sort: String,
    canonical_ids: Vec<String>,
) -> Result<Vec<AlbumRowDto>, String> {
    // Validated here, before with_conn, so a rejected sort never opens the database.
    // query_albums re-validates so it is self-contained; don't "simplify" this line away.
    order_by_clause(&sort)?;

    state.with_conn(&app, |conn| query_albums(conn, &sort, &canonical_ids))
}

fn query_albums(
    conn: &Connection,
    sort: &str,
    canonical_ids: &[String],
) -> Result<Vec<AlbumRowDto>, String> {
    let order = order_by_clause(sort)?;
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<AlbumRowDto> {
        Ok(AlbumRowDto {
            id: row.get(0)?,
            server_id: row.get(1)?,
            name: row.get(2)?,
            artist: row.get(3)?,
            year: row.get(4)?,
            artwork_url: row.get(5)?,
            release_type: row.get(6)?,
            accent_color: row.get(7)?,
        })
    };

    if canonical_ids.is_empty() {
        let sql = format!(
            "SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type, a.accent_color
             FROM albums a ORDER BY {order}"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    } else {
        let placeholders = canonical_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");
        // Join through album_genres - covers both leaf and ancestor canon ids,
        // as well as raw: synthetic ids for unmatched tags.
        let sql = format!(
            "SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type, a.accent_color
             FROM albums a
             JOIN album_genres ag ON ag.album_id = a.id
             WHERE ag.canonical_id IN ({placeholders})
             ORDER BY {order}"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params = rusqlite::params_from_iter(canonical_ids.iter());
        let rows = stmt
            .query_map(params, map_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_read::test_fixtures::*;

    const SORT_KEYS: [&str; 4] = ["artist", "alphabetical", "year", "recently_added"];

    fn ids(rows: &[AlbumRowDto]) -> Vec<&str> {
        rows.iter().map(|r| r.id.as_str()).collect()
    }

    #[test]
    fn each_allowlisted_sort_key_maps_to_its_own_order_by_fragment() {
        assert_eq!(
            order_by_clause("artist").unwrap(),
            "a.artist COLLATE NOCASE, a.name COLLATE NOCASE"
        );
        assert_eq!(
            order_by_clause("alphabetical").unwrap(),
            "a.name COLLATE NOCASE"
        );
        assert_eq!(
            order_by_clause("year").unwrap(),
            "a.year DESC, a.name COLLATE NOCASE"
        );
        assert_eq!(
            order_by_clause("recently_added").unwrap(),
            "COALESCE(a.navidrome_created, a.created_at) DESC"
        );
    }

    #[test]
    fn an_unknown_sort_key_is_rejected_and_named_in_the_error() {
        let err = order_by_clause("popularity").expect_err("unknown keys must not fall through");
        assert!(
            err.contains("popularity"),
            "error should name the offending key: {err}"
        );
    }

    #[test]
    fn sort_keys_are_matched_exactly_so_case_and_padding_variants_are_rejected() {
        for key in ["Artist", "ARTIST", " artist", "artist ", "artist\n"] {
            assert!(
                order_by_clause(key).is_err(),
                "{key:?} is not an allowlisted key and must be rejected"
            );
        }
    }

    #[test]
    fn a_sort_key_carrying_sql_is_rejected_rather_than_interpolated() {
        for injection in [
            "artist; DROP TABLE albums",
            "a.name/**/UNION/**/SELECT/**/1",
            "1 -- ",
            "artist' OR '1'='1",
            "",
        ] {
            assert!(
                order_by_clause(injection).is_err(),
                "{injection:?} must never reach the SQL string"
            );
        }
    }

    #[test]
    fn a_sort_key_of_only_whitespace_is_rejected() {
        for key in [" ", "\t", "\n", "   \t\n "] {
            assert!(
                order_by_clause(key).is_err(),
                "{key:?} is not an allowlisted key and must be rejected"
            );
        }
    }

    #[test]
    fn a_sort_key_that_only_looks_like_an_allowlisted_one_is_rejected() {
        for key in [
            "\u{430}rtist",  // Cyrillic a
            "art\u{131}st",  // dotless i
            "\u{ff41}rtist", // full-width a
            "artist\0",      // interior NUL
            "artist\u{200b}",
        ] {
            assert!(
                order_by_clause(key).is_err(),
                "{key:?} is a homoglyph of an allowlisted key, not the key itself"
            );
        }
    }

    #[test]
    fn no_allowlisted_order_by_fragment_carries_sql_metacharacters() {
        // The allowlist is designed to grow. This holds for arms added later too.
        for key in SORT_KEYS {
            let fragment = order_by_clause(key).expect("allowlisted");
            for bad in [";", "--", "'", "\"", "/*"] {
                assert!(
                    !fragment.contains(bad),
                    "fragment for {key:?} contains {bad:?}: {fragment}"
                );
            }
        }
    }

    #[test]
    fn every_allowlisted_sort_executes_against_both_the_filtered_and_unfiltered_query() {
        let conn = fixture_conn();
        insert_album(&conn, "s1:al1", "s1", "Album", "Artist");
        insert_genre(&conn, "s1:al1", "rock", "direct");

        for sort in SORT_KEYS {
            let unfiltered = query_albums(&conn, sort, &[]).unwrap_or_else(|e| {
                panic!("unfiltered {sort} must be valid SQL: {e}");
            });
            assert_eq!(ids(&unfiltered), ["s1:al1"]);

            let filtered = query_albums(&conn, sort, &["rock".to_string()])
                .unwrap_or_else(|e| panic!("genre-filtered {sort} must be valid SQL: {e}"));
            assert_eq!(ids(&filtered), ["s1:al1"]);
        }
    }

    #[test]
    fn an_unknown_sort_is_rejected_by_query_albums_before_any_sql_runs() {
        let conn = Connection::open_in_memory().expect("db with no albums table at all");
        assert!(query_albums(&conn, "popularity", &[]).is_err());
    }

    #[test]
    fn each_album_row_reports_the_server_id_stored_on_that_row() {
        let conn = fixture_conn();
        insert_album(&conn, "s1:al1", "s1", "A", "Artist");
        insert_album(&conn, "s2:al1", "s2", "B", "Artist");

        let rows = query_albums(&conn, "alphabetical", &[]).expect("query");
        let owners: Vec<(&str, &str)> = rows
            .iter()
            .map(|r| (r.id.as_str(), r.server_id.as_str()))
            .collect();
        assert_eq!(owners, [("s1:al1", "s1"), ("s2:al1", "s2")]);
    }

    #[test]
    fn albums_sort_alphabetically_case_insensitively() {
        let conn = fixture_conn();
        insert_album(&conn, "s1:b", "s1", "beta", "X");
        insert_album(&conn, "s1:a", "s1", "Alpha", "X");
        insert_album(&conn, "s1:c", "s1", "Gamma", "X");

        let rows = query_albums(&conn, "alphabetical", &[]).expect("query");
        assert_eq!(ids(&rows), ["s1:a", "s1:b", "s1:c"]);
    }

    #[test]
    fn the_year_sort_is_descending_and_breaks_ties_by_name() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO albums (id, server_id, name, year) VALUES
               ('s1:old', 's1', 'Old', 1990),
               ('s1:z',   's1', 'Zed', 2020),
               ('s1:a',   's1', 'Ant', 2020)",
        )
        .expect("seed");

        let rows = query_albums(&conn, "year", &[]).expect("query");
        assert_eq!(ids(&rows), ["s1:a", "s1:z", "s1:old"]);
    }

    #[test]
    fn recently_added_falls_back_to_created_at_when_navidrome_created_is_null() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO albums (id, server_id, name, navidrome_created, created_at) VALUES
               ('s1:nav',  's1', 'Nav',  '2026-03-01', '2020-01-01'),
               ('s1:local','s1', 'Local', NULL,        '2026-02-01'),
               ('s1:older','s1', 'Older', NULL,        '2026-01-01')",
        )
        .expect("seed");

        let rows = query_albums(&conn, "recently_added", &[]).expect("query");
        assert_eq!(ids(&rows), ["s1:nav", "s1:local", "s1:older"]);
    }

    #[test]
    fn the_genre_filter_keeps_only_albums_carrying_one_of_the_requested_ids() {
        let conn = fixture_conn();
        insert_album(&conn, "s1:rock", "s1", "Rock One", "X");
        insert_album(&conn, "s1:jazz", "s1", "Jazz One", "X");
        insert_genre(&conn, "s1:rock", "rock", "direct");
        insert_genre(&conn, "s1:jazz", "jazz", "direct");

        let rows = query_albums(&conn, "alphabetical", &["jazz".to_string()]).expect("query");
        assert_eq!(ids(&rows), ["s1:jazz"]);
    }

    #[test]
    fn the_genre_filter_matches_ancestor_and_raw_rows_not_only_direct_ones() {
        let conn = fixture_conn();
        insert_album(&conn, "s1:anc", "s1", "Ancestor", "X");
        insert_album(&conn, "s1:raw", "s1", "Raw", "X");
        insert_genre(&conn, "s1:anc", "rock", "ancestor");
        insert_genre(&conn, "s1:raw", "raw:weird tag", "direct");

        let anc = query_albums(&conn, "alphabetical", &["rock".to_string()]).expect("query");
        assert_eq!(ids(&anc), ["s1:anc"]);

        let raw =
            query_albums(&conn, "alphabetical", &["raw:weird tag".to_string()]).expect("query");
        assert_eq!(ids(&raw), ["s1:raw"]);
    }

    #[test]
    fn an_album_matching_two_requested_genres_is_returned_once() {
        let conn = fixture_conn();
        insert_album(&conn, "s1:al1", "s1", "Both", "X");
        insert_genre(&conn, "s1:al1", "rock", "direct");
        insert_genre(&conn, "s1:al1", "pop", "ancestor");

        let rows = query_albums(
            &conn,
            "alphabetical",
            &["rock".to_string(), "pop".to_string()],
        )
        .expect("query");
        assert_eq!(
            ids(&rows),
            ["s1:al1"],
            "SELECT DISTINCT must collapse the join"
        );
    }
}
