use super::LibraryReadStore;
use rusqlite::Connection;
use serde::Serialize;
#[derive(Serialize)]
pub struct GenreRowDto {
    canonical_id: String,
    name: String,
    album_count: i64,
}

// Leaf (direct) canon-tree genres for the library filter sidebar. Mirrors the query
// that used to live in src/hooks/useGenres.ts; raw: synthetic ids stay excluded.
#[tauri::command]
pub fn get_genres(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<GenreRowDto>, String> {
    state.with_conn(&app, query_genres)
}

fn query_genres(conn: &Connection) -> Result<Vec<GenreRowDto>, String> {
    let sql = "SELECT canonical_id, MIN(name) AS name, COUNT(DISTINCT album_id) AS album_count
         FROM album_genres
         WHERE relation = 'direct'
           AND canonical_id NOT LIKE 'raw:%'
         GROUP BY canonical_id
         ORDER BY name COLLATE NOCASE";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_genre_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn map_genre_row(row: &rusqlite::Row) -> rusqlite::Result<GenreRowDto> {
    Ok(GenreRowDto {
        canonical_id: row.get(0)?,
        name: row.get(1)?,
        album_count: row.get(2)?,
    })
}

// Genres from the 10 most recently played albums, falling back to top genres by
// album_count when there is no scrobble history. The fallback branch lived in JS
// before (src/hooks/useGenres.ts useRecentGenres); it is decided here now so the
// no-history case costs one IPC round trip instead of two.
#[tauri::command]
pub fn get_recent_genres(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<GenreRowDto>, String> {
    state.with_conn(&app, query_recent_genres)
}

fn query_recent_genres(conn: &Connection) -> Result<Vec<GenreRowDto>, String> {
    let recent_sql = "WITH recent_albums AS (
            SELECT t.album_id, MAX(sh.scrobbled_at) AS last_played
            FROM scrobble_history sh
            JOIN tracks t ON t.id = sh.track_id
            GROUP BY t.album_id
            ORDER BY last_played DESC
            LIMIT 10
        )
        SELECT ag.canonical_id, MIN(ag.name) AS name, COUNT(DISTINCT ag.album_id) AS album_count
        FROM recent_albums ra
        JOIN album_genres ag ON ag.album_id = ra.album_id
        WHERE ag.relation = 'direct'
          AND ag.canonical_id NOT LIKE 'raw:%'
        GROUP BY ag.canonical_id
        HAVING (
          SELECT COUNT(DISTINCT ag2.album_id) FROM album_genres ag2
          WHERE ag2.canonical_id = ag.canonical_id AND ag2.relation = 'direct'
        ) >= 5
        ORDER BY MAX(ra.last_played) DESC, name COLLATE NOCASE";
    let mut stmt = conn.prepare(recent_sql).map_err(|e| e.to_string())?;
    let recent = stmt
        .query_map([], map_genre_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if !recent.is_empty() {
        return Ok(recent);
    }

    let fallback_sql =
        "SELECT canonical_id, MIN(name) AS name, COUNT(DISTINCT album_id) AS album_count
         FROM album_genres
         WHERE relation = 'direct' AND canonical_id NOT LIKE 'raw:%'
         GROUP BY canonical_id
         HAVING COUNT(DISTINCT album_id) >= 5
         ORDER BY album_count DESC, name COLLATE NOCASE
         LIMIT 18";
    let mut stmt = conn.prepare(fallback_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_genre_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_read::test_fixtures::*;

    fn genre_ids(rows: &[GenreRowDto]) -> Vec<&str> {
        rows.iter().map(|r| r.canonical_id.as_str()).collect()
    }

    #[test]
    fn genres_count_distinct_albums_and_exclude_ancestor_and_raw_rows() {
        let conn = fixture_conn();
        for (album, canonical, relation) in [
            ("al1", "rock", "direct"),
            ("al2", "rock", "direct"),
            ("al1", "pop", "ancestor"),
            ("al1", "raw:weird", "direct"),
            ("al3", "jazz", "direct"),
        ] {
            insert_genre(&conn, album, canonical, relation);
        }

        let rows = query_genres(&conn).expect("query");
        assert_eq!(
            genre_ids(&rows),
            ["jazz", "rock"],
            "ordered by name, nocase"
        );
        assert_eq!(rows[1].album_count, 2);
    }

    #[test]
    fn genres_are_empty_when_nothing_is_tagged() {
        let conn = fixture_conn();
        assert!(query_genres(&conn).expect("query").is_empty());
    }

    /// Album `a{i}` tagged `g{i}`, with `fillers` extra albums carrying the same
    /// genre so it can clear the library-wide `>= 5` threshold.
    fn seed_genre_with_library_weight(conn: &Connection, i: usize, fillers: usize) {
        insert_genre(conn, &format!("a{i}"), &format!("g{i}"), "direct");
        for f in 0..fillers {
            insert_genre(conn, &format!("filler{i}-{f}"), &format!("g{i}"), "direct");
        }
    }

    fn seed_scrobble(conn: &Connection, i: usize, at: &str) {
        conn.execute(
            "INSERT INTO tracks (id, server_id, title, album_id) VALUES (?, 's1', 'T', ?)",
            [&format!("t{i}"), &format!("a{i}")],
        )
        .expect("track");
        conn.execute(
            "INSERT INTO scrobble_history (track_id, timestamp, scrobbled_at) VALUES (?, ?, ?)",
            rusqlite::params![format!("t{i}"), i as i64, at],
        )
        .expect("scrobble");
    }

    #[test]
    fn recent_genres_covers_only_the_ten_most_recently_played_albums() {
        let conn = fixture_conn();
        for i in 0..11 {
            seed_genre_with_library_weight(&conn, i, 4);
            seed_scrobble(&conn, i, &format!("2026-01-{:02}", i + 1));
        }

        let rows = query_recent_genres(&conn).expect("query");
        let found = genre_ids(&rows);
        assert_eq!(found.len(), 10);
        assert!(
            !found.contains(&"g0"),
            "the 11th-most-recent album must fall outside the LIMIT 10 window: {found:?}"
        );
        assert_eq!(found[0], "g10", "ordered by most recently played first");
    }

    #[test]
    fn a_recently_played_genre_below_the_library_wide_threshold_is_dropped() {
        let conn = fixture_conn();
        // g0 has 5 albums library-wide, g1 only 4. Both were played just now.
        seed_genre_with_library_weight(&conn, 0, 4);
        seed_genre_with_library_weight(&conn, 1, 3);
        seed_scrobble(&conn, 0, "2026-01-01");
        seed_scrobble(&conn, 1, "2026-01-02");

        let rows = query_recent_genres(&conn).expect("query");
        assert_eq!(genre_ids(&rows), ["g0"]);
    }

    #[test]
    fn a_genre_on_one_recent_album_still_qualifies_on_its_library_wide_count() {
        // The HAVING subquery counts the whole album_genres table, not the 10-album
        // window - a genre seen once recently but 5 times overall is kept.
        let conn = fixture_conn();
        seed_genre_with_library_weight(&conn, 0, 4);
        seed_scrobble(&conn, 0, "2026-01-01");

        let rows = query_recent_genres(&conn).expect("query");
        assert_eq!(genre_ids(&rows), ["g0"]);
        assert_eq!(rows[0].album_count, 1, "count is over the recent window");
    }

    #[test]
    fn recent_genres_falls_back_to_top_genres_when_there_is_no_scrobble_history() {
        let conn = fixture_conn();
        seed_genre_with_library_weight(&conn, 0, 6); // 7 albums
        seed_genre_with_library_weight(&conn, 1, 4); // 5 albums
        seed_genre_with_library_weight(&conn, 2, 3); // 4 albums, below threshold

        let rows = query_recent_genres(&conn).expect("query");
        assert_eq!(
            genre_ids(&rows),
            ["g0", "g1"],
            "ordered by album_count desc"
        );
        assert_eq!(rows[0].album_count, 7);
    }

    #[test]
    fn recent_genres_falls_back_when_the_history_yields_no_qualifying_genre() {
        // Scrobbles exist, but the played album's genre is under the threshold, so
        // the recent branch returns empty and the fallback still has to run.
        let conn = fixture_conn();
        seed_genre_with_library_weight(&conn, 0, 1); // played, only 2 albums
        seed_scrobble(&conn, 0, "2026-01-01");
        seed_genre_with_library_weight(&conn, 9, 5); // unplayed, 6 albums

        let rows = query_recent_genres(&conn).expect("query");
        assert_eq!(genre_ids(&rows), ["g9"]);
    }

    #[test]
    fn the_fallback_returns_at_most_eighteen_genres() {
        let conn = fixture_conn();
        // 19 qualifying genres with strictly distinct counts, so the cut is not a tie.
        for i in 0..19 {
            seed_genre_with_library_weight(&conn, i, 4 + i);
        }

        let rows = query_recent_genres(&conn).expect("query");
        assert_eq!(rows.len(), 18);
        assert!(
            !genre_ids(&rows).contains(&"g0"),
            "the smallest qualifying genre is the one dropped"
        );
    }

    /// Genre `g{i:02}` under an explicit display name, with `fillers` extra albums so it
    /// clears the library-wide threshold.
    fn seed_named_genre(conn: &Connection, i: usize, name: &str, fillers: usize) {
        let canonical = format!("g{i:02}");
        for f in 0..=fillers {
            conn.execute(
                "INSERT INTO album_genres (album_id, canonical_id, relation, name)
                 VALUES (?, ?, 'direct', ?)",
                [&format!("a{i}-{f}"), &canonical, &name.to_string()],
            )
            .expect("insert album_genre");
        }
    }

    #[test]
    fn the_fallback_breaks_an_album_count_tie_by_name_so_the_cut_cannot_reshuffle() {
        // album_count is not unique, so with 19 genres tied on it the 18-row cut is
        // decided by nothing at all and the last row swapped between refreshes. Names are
        // deliberately uncorrelated with canonical_id, so grouping order cannot pass this.
        let conn = fixture_conn();
        let names = [
            "m", "q", "a", "z", "c", "x", "b", "y", "d", "w", "e", "v", "f", "u", "g", "t", "h",
            "s", "i",
        ];
        for (i, name) in names.iter().enumerate() {
            seed_named_genre(&conn, i, name, 4);
        }

        let rows = query_recent_genres(&conn).expect("query");
        let mut expected: Vec<&str> = names.to_vec();
        expected.sort_unstable();
        expected.truncate(18);

        assert_eq!(rows.len(), 18);
        assert_eq!(
            rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            expected,
            "ties order by name, so the same 18 survive every refresh"
        );
    }

    #[test]
    fn the_recent_branch_breaks_a_last_played_tie_by_name_so_the_rail_cannot_reshuffle() {
        // One album carries several genres, so every one of its rows shares the same
        // MAX(last_played). Without a tiebreak the rail's order is decided by nothing and
        // swaps between refreshes. Names are uncorrelated with canonical_id on purpose.
        let conn = fixture_conn();
        let names = ["m", "a", "z", "c", "b"];
        for (i, name) in names.iter().enumerate() {
            seed_named_genre(&conn, i, name, 4);
            // Tag the one played album with every genre, tying them all on last_played.
            conn.execute(
                "INSERT INTO album_genres (album_id, canonical_id, relation, name)
                 VALUES ('played', ?, 'direct', ?)",
                [&format!("g{i:02}"), &name.to_string()],
            )
            .expect("insert album_genre");
        }
        conn.execute(
            "INSERT INTO tracks (id, server_id, title, album_id)
             VALUES ('t', 's1', 'T', 'played')",
            [],
        )
        .expect("track");
        conn.execute(
            "INSERT INTO scrobble_history (track_id, timestamp, scrobbled_at)
             VALUES ('t', 1, '2026-01-01')",
            [],
        )
        .expect("scrobble");

        let rows = query_recent_genres(&conn).expect("query");
        let mut expected: Vec<&str> = names.to_vec();
        expected.sort_unstable();
        assert_eq!(
            rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            expected,
            "ties on last_played order by name, so the rail is stable across refreshes"
        );
    }

    #[test]
    fn a_genre_carrying_two_display_names_resolves_to_one_deterministic_label() {
        // Renaming a genre in the tree re-normalizes albums incrementally, so
        // album_genres holds both the old and new name under one canonical_id until the
        // last album is reprocessed. A bare column under GROUP BY picks arbitrarily.
        let conn = fixture_conn();
        for (album, name) in [
            ("a0", "Zydeco"),
            ("a1", "Alt Zydeco"),
            ("a2", "Zydeco"),
            ("a3", "Alt Zydeco"),
            ("a4", "Zydeco"),
        ] {
            conn.execute(
                "INSERT INTO album_genres (album_id, canonical_id, relation, name)
                 VALUES (?, 'zydeco', 'direct', ?)",
                [album, name],
            )
            .expect("insert album_genre");
        }

        assert_eq!(query_genres(&conn).expect("query")[0].name, "Alt Zydeco");
        assert_eq!(
            query_recent_genres(&conn).expect("query")[0].name,
            "Alt Zydeco",
            "the fallback branch agrees with the full listing"
        );
    }
}
