use super::LibraryReadStore;
use rusqlite::Connection;
use serde::Serialize;
#[derive(Serialize)]
pub struct AllTrackRowDto {
    id: String,
    title: String,
    artist: Option<String>,
    album_artist: Option<String>,
    album_id: String,
    album_name: Option<String>,
    album_artwork_url: Option<String>,
    genre: Option<String>,
    track_number: Option<i64>,
    disc_number: Option<i64>,
    year: Option<i64>,
    duration: Option<i64>,
    play_count: Option<i64>,
    bit_rate: Option<i64>,
    suffix: Option<String>,
    replay_gain_track_gain: Option<f64>,
    replay_gain_track_peak: Option<f64>,
    replay_gain_album_gain: Option<f64>,
    replay_gain_album_peak: Option<f64>,
}

#[derive(Serialize)]
pub struct TrackRowDto {
    id: String,
    title: String,
    artist: Option<String>,
    album_artist: Option<String>,
    album_id: String,
    genre: Option<String>,
    track_number: Option<i64>,
    disc_number: Option<i64>,
    year: Option<i64>,
    duration: Option<i64>,
    file_path: Option<String>,
    play_count: Option<i64>,
    bit_rate: Option<i64>,
    suffix: Option<String>,
    file_size: Option<i64>,
    replay_gain_track_gain: Option<f64>,
    replay_gain_track_peak: Option<f64>,
    replay_gain_album_gain: Option<f64>,
    replay_gain_album_peak: Option<f64>,
}

#[tauri::command]
pub fn get_all_tracks(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<AllTrackRowDto>, String> {
    state.with_conn(&app, query_all_tracks)
}

fn query_all_tracks(conn: &Connection) -> Result<Vec<AllTrackRowDto>, String> {
    let sql = "SELECT t.id, t.title, t.artist, t.album_artist, t.album_id,
                a.name AS album_name, a.artwork_url AS album_artwork_url,
                t.genre, t.track_number, t.disc_number, t.year, t.duration,
                t.play_count, t.bit_rate, t.suffix,
                t.replay_gain_track_gain, t.replay_gain_track_peak,
                t.replay_gain_album_gain, t.replay_gain_album_peak
         FROM tracks t
         LEFT JOIN albums a ON a.id = t.album_id
         ORDER BY t.artist COLLATE NOCASE, a.name COLLATE NOCASE, t.disc_number, t.track_number";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AllTrackRowDto {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album_artist: row.get(3)?,
                album_id: row.get(4)?,
                album_name: row.get(5)?,
                album_artwork_url: row.get(6)?,
                genre: row.get(7)?,
                track_number: row.get(8)?,
                disc_number: row.get(9)?,
                year: row.get(10)?,
                duration: row.get(11)?,
                play_count: row.get(12)?,
                bit_rate: row.get(13)?,
                suffix: row.get(14)?,
                replay_gain_track_gain: row.get(15)?,
                replay_gain_track_peak: row.get(16)?,
                replay_gain_album_gain: row.get(17)?,
                replay_gain_album_peak: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_tracks(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
    album_id: String,
) -> Result<Vec<TrackRowDto>, String> {
    state.with_conn(&app, |conn| query_tracks(conn, &album_id))
}

fn query_tracks(conn: &Connection, album_id: &str) -> Result<Vec<TrackRowDto>, String> {
    let sql = "SELECT id, title, artist, album_artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count, bit_rate, suffix, file_size, replay_gain_track_gain, replay_gain_track_peak, replay_gain_album_gain, replay_gain_album_peak
        FROM tracks
        WHERE album_id = ?
        ORDER BY disc_number, track_number";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([album_id], |row| {
            Ok(TrackRowDto {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album_artist: row.get(3)?,
                album_id: row.get(4)?,
                genre: row.get(5)?,
                track_number: row.get(6)?,
                disc_number: row.get(7)?,
                year: row.get(8)?,
                duration: row.get(9)?,
                file_path: row.get(10)?,
                play_count: row.get(11)?,
                bit_rate: row.get(12)?,
                suffix: row.get(13)?,
                file_size: row.get(14)?,
                replay_gain_track_gain: row.get(15)?,
                replay_gain_track_peak: row.get(16)?,
                replay_gain_album_gain: row.get(17)?,
                replay_gain_album_peak: row.get(18)?,
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

    /// Distinct sentinel per column, so swapping two same-typed adjacent columns
    /// (both REAL, both INTEGER) fails instead of typechecking and returning garbage.
    fn insert_sentinel_track(conn: &Connection, id: &str, album_id: Option<&str>) {
        conn.execute(
            "INSERT INTO tracks (id, server_id, title, artist, album_artist, album_id, genre,
                track_number, disc_number, year, duration, file_path, play_count, bit_rate,
                suffix, file_size, replay_gain_track_gain, replay_gain_track_peak,
                replay_gain_album_gain, replay_gain_album_peak)
             VALUES (?, 's1', 'the title', 'the artist', 'the album artist', ?, 'the genre',
                7, 3, 1999, 251, '/the/path.flac', 42, 993, 'flac', 12345,
                -1.5, 0.25, -2.5, 0.75)",
            rusqlite::params![id, album_id],
        )
        .expect("insert track");
    }

    #[test]
    fn every_all_tracks_column_lands_in_its_own_field() {
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO albums (id, server_id, name, artwork_url)
             VALUES ('s1:al', 's1', 'the album name', 'the album artwork')",
            [],
        )
        .expect("seed album");
        insert_sentinel_track(&conn, "s1:t1", Some("s1:al"));

        let rows = query_all_tracks(&conn).expect("query");
        let t = &rows[0];
        assert_eq!(t.id, "s1:t1");
        assert_eq!(t.title, "the title");
        assert_eq!(t.artist.as_deref(), Some("the artist"));
        assert_eq!(t.album_artist.as_deref(), Some("the album artist"));
        assert_eq!(t.album_id, "s1:al");
        assert_eq!(t.album_name.as_deref(), Some("the album name"));
        assert_eq!(t.album_artwork_url.as_deref(), Some("the album artwork"));
        assert_eq!(t.genre.as_deref(), Some("the genre"));
        assert_eq!(t.track_number, Some(7));
        assert_eq!(t.disc_number, Some(3));
        assert_eq!(t.year, Some(1999));
        assert_eq!(t.duration, Some(251));
        assert_eq!(t.play_count, Some(42));
        assert_eq!(t.bit_rate, Some(993));
        assert_eq!(t.suffix.as_deref(), Some("flac"));
        assert_eq!(t.replay_gain_track_gain, Some(-1.5));
        assert_eq!(t.replay_gain_track_peak, Some(0.25));
        assert_eq!(t.replay_gain_album_gain, Some(-2.5));
        assert_eq!(t.replay_gain_album_peak, Some(0.75));
    }

    #[test]
    fn a_track_with_no_album_id_fails_the_whole_all_tracks_call() {
        // tracks.album_id is nullable in the schema but AllTrackRowDto.album_id is
        // not Option, so one orphan row errors the entire library list rather than
        // dropping itself.
        let conn = fixture_conn();
        insert_sentinel_track(&conn, "s1:ok", Some("s1:al"));
        insert_sentinel_track(&conn, "s1:orphan", None);

        assert!(query_all_tracks(&conn).is_err());
    }

    #[test]
    fn all_tracks_orders_by_artist_then_album_then_disc_then_track() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO albums (id, server_id, name) VALUES
               ('s1:a1', 's1', 'Alpha'), ('s1:a2', 's1', 'Beta');
             INSERT INTO tracks (id, server_id, title, artist, album_id, disc_number, track_number)
               VALUES
               ('t4', 's1', 'd', 'zz', 's1:a1', 1, 1),
               ('t3', 's1', 'c', 'aa', 's1:a2', 1, 1),
               ('t2', 's1', 'b', 'aa', 's1:a1', 2, 1),
               ('t1', 's1', 'a', 'aa', 's1:a1', 1, 2)",
        )
        .expect("seed");

        let rows = query_all_tracks(&conn).expect("query");
        let order: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(order, ["t1", "t2", "t3", "t4"]);
    }

    #[test]
    fn every_track_column_lands_in_its_own_field() {
        let conn = fixture_conn();
        insert_sentinel_track(&conn, "s1:t1", Some("s1:al"));

        let rows = query_tracks(&conn, "s1:al").expect("query");
        let t = &rows[0];
        assert_eq!(t.id, "s1:t1");
        assert_eq!(t.title, "the title");
        assert_eq!(t.artist.as_deref(), Some("the artist"));
        assert_eq!(t.album_artist.as_deref(), Some("the album artist"));
        assert_eq!(t.album_id, "s1:al");
        assert_eq!(t.genre.as_deref(), Some("the genre"));
        assert_eq!(t.track_number, Some(7));
        assert_eq!(t.disc_number, Some(3));
        assert_eq!(t.year, Some(1999));
        assert_eq!(t.duration, Some(251));
        assert_eq!(t.file_path.as_deref(), Some("/the/path.flac"));
        assert_eq!(t.play_count, Some(42));
        assert_eq!(t.bit_rate, Some(993));
        assert_eq!(t.suffix.as_deref(), Some("flac"));
        assert_eq!(t.file_size, Some(12345));
        assert_eq!(t.replay_gain_track_gain, Some(-1.5));
        assert_eq!(t.replay_gain_track_peak, Some(0.25));
        assert_eq!(t.replay_gain_album_gain, Some(-2.5));
        assert_eq!(t.replay_gain_album_peak, Some(0.75));
    }

    #[test]
    fn tracks_are_scoped_to_the_requested_album_and_ordered_by_disc_then_number() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO tracks (id, server_id, title, album_id, disc_number, track_number) VALUES
               ('s1:x', 's1', 'other album', 's1:other', 1, 1),
               ('s1:c', 's1', 'disc two',    's1:al',    2, 1),
               ('s1:b', 's1', 'second',      's1:al',    1, 2),
               ('s1:a', 's1', 'first',       's1:al',    1, 1)",
        )
        .expect("seed");

        let rows = query_tracks(&conn, "s1:al").expect("query");
        let order: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(order, ["s1:a", "s1:b", "s1:c"]);
    }

    #[test]
    fn an_album_id_from_another_server_returns_no_tracks() {
        // Album ids carry a `${server_id}:` prefix, which is the only thing scoping
        // this query - there is no server_id filter in the SQL.
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO tracks (id, server_id, title, album_id) VALUES ('s1:t','s1','T','s1:al')",
            [],
        )
        .expect("seed");

        assert!(query_tracks(&conn, "s2:al").expect("query").is_empty());
    }
}
