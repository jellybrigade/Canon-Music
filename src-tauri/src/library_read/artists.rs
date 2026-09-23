use super::LibraryReadStore;
use rusqlite::Connection;
use serde::Serialize;
#[derive(Serialize)]
pub struct ArtistRowDto {
    name: String,
    album_count: i64,
    artwork_url: Option<String>,
    lastfm_image_url: Option<String>,
    wikidata_image_url: Option<String>,
    navidrome_image_url: Option<String>,
    enriched_at: Option<i64>,
}

#[tauri::command]
pub fn get_artists(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<ArtistRowDto>, String> {
    state.with_conn(&app, query_artists)
}

fn query_artists(conn: &Connection) -> Result<Vec<ArtistRowDto>, String> {
    let sql = "SELECT
            a.name,
            a.album_count,
            art.artwork_url,
            ai.lastfm_image_url,
            ai.wikidata_image_url,
            ai.navidrome_image_url,
            ai.enriched_at
        FROM artists a
        LEFT JOIN artist_identity ai ON ai.artist_name = a.name
        LEFT JOIN (
            SELECT artist, server_id, artwork_url FROM (
                SELECT artist, server_id, artwork_url,
                       ROW_NUMBER() OVER (
                           PARTITION BY artist, server_id
                           ORDER BY navidrome_created DESC, year DESC, id
                       ) AS rn
                FROM albums
                WHERE artwork_url IS NOT NULL
            ) WHERE rn = 1
        ) art ON art.artist = a.name AND art.server_id = a.server_id
        WHERE a.name NOT IN (SELECT alias_name FROM artist_aliases)
        ORDER BY a.name COLLATE NOCASE";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ArtistRowDto {
                name: row.get(0)?,
                album_count: row.get(1)?,
                artwork_url: row.get(2)?,
                lastfm_image_url: row.get(3)?,
                wikidata_image_url: row.get(4)?,
                navidrome_image_url: row.get(5)?,
                enriched_at: row.get(6)?,
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
    fn an_artist_that_is_an_alias_of_another_is_excluded() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES
               ('a1', 's1', 'Kanye West', 3),
               ('a2', 's1', 'Ye', 1);
             INSERT INTO artist_aliases (alias_name, canonical_name)
               VALUES ('Ye', 'Kanye West')",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Kanye West"]);
        assert_eq!(rows[0].album_count, 3);
    }

    #[test]
    fn artist_artwork_is_taken_from_an_album_on_that_artists_own_server() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES ('a1', 's1', 'Solo', 1);
             INSERT INTO albums (id, server_id, name, artist, artwork_url) VALUES
               ('s1:al', 's1', 'Mine',  'Solo', 'cover://s1'),
               ('s2:al', 's2', 'Theirs','Solo', 'cover://s2')",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows[0].artwork_url.as_deref(), Some("cover://s1"));
    }

    #[test]
    fn an_artist_with_no_album_artwork_and_no_enrichment_reports_nulls_not_an_error() {
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES ('a1','s1','Bare',0)",
            [],
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].artwork_url.is_none());
        assert!(rows[0].lastfm_image_url.is_none());
        assert!(rows[0].enriched_at.is_none());
    }

    #[test]
    fn enrichment_columns_are_joined_by_artist_name() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES ('a1','s1','Named',2);
             INSERT INTO artist_identity
               (artist_name, lastfm_image_url, wikidata_image_url, navidrome_image_url, enriched_at)
               VALUES ('Named', 'lfm', 'wd', 'nav', 1700)",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows[0].lastfm_image_url.as_deref(), Some("lfm"));
        assert_eq!(rows[0].wikidata_image_url.as_deref(), Some("wd"));
        assert_eq!(rows[0].navidrome_image_url.as_deref(), Some("nav"));
        assert_eq!(rows[0].enriched_at, Some(1700));
    }

    #[test]
    fn one_artist_name_present_on_two_servers_returns_one_row_per_server() {
        // Current behavior, pinned deliberately: `artists.id` is a random hex, not
        // server-prefixed, and ArtistRowDto has no server_id, so the two rows are
        // indistinguishable downstream. See instructions/donow.md.
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES
               ('a1', 's1', 'Shared', 2),
               ('a2', 's2', 'Shared', 5)",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Shared");
        assert_eq!(rows[1].name, "Shared");
    }

    #[test]
    fn artist_artwork_comes_from_the_newest_album_not_an_arbitrary_row() {
        // A bare column under GROUP BY picks whichever row the scan happened to keep, so
        // the tile's artwork changed after unrelated writes reshuffled the table.
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES ('a1','s1','Solo',2);
             INSERT INTO albums (id, server_id, name, artist, artwork_url, navidrome_created) VALUES
               ('s1:old', 's1', 'Debut',  'Solo', 'cover://old', '2020-01-01'),
               ('s1:new', 's1', 'Latest', 'Solo', 'cover://new', '2024-01-01')",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows[0].artwork_url.as_deref(), Some("cover://new"));
    }

    #[test]
    fn artist_artwork_falls_back_to_year_then_id_when_no_album_carries_a_created_date() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES ('a1','s1','Solo',3);
             INSERT INTO albums (id, server_id, name, artist, artwork_url, year) VALUES
               ('s1:c', 's1', 'C', 'Solo', 'cover://1999', 1999),
               ('s1:a', 's1', 'A', 'Solo', 'cover://2010a', 2010),
               ('s1:b', 's1', 'B', 'Solo', 'cover://2010b', 2010)",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows[0].artwork_url.as_deref(), Some("cover://2010a"));
    }

    #[test]
    fn an_album_with_a_created_date_outranks_one_without() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO artists (id, server_id, name, album_count) VALUES ('a1','s1','Solo',2);
             INSERT INTO albums (id, server_id, name, artist, artwork_url, navidrome_created) VALUES
               ('s1:a', 's1', 'A', 'Solo', 'cover://undated', NULL),
               ('s1:b', 's1', 'B', 'Solo', 'cover://dated', '2001-01-01')",
        )
        .expect("seed");

        let rows = query_artists(&conn).expect("query");
        assert_eq!(rows[0].artwork_url.as_deref(), Some("cover://dated"));
    }
}
