// Pilot for the tauri-plugin-sql -> rusqlite migration (psysonic pattern, see
// instructions/donow.md "rusqlite write/read split"). Read-only connection to the
// same canon.db file tauri-plugin-sql already writes/migrates - avoids per-query
// IPC-to-sqlx round trips for hot-path list queries. Writes and migrations stay on
// tauri-plugin-sql for now; only read commands piloted here (albums first).
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

#[derive(Default)]
pub struct LibraryReadStore {
    conn: Mutex<Option<Connection>>,
}

impl LibraryReadStore {
    fn with_conn<T>(
        &self,
        app: &tauri::AppHandle,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| "library read store lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(open_read_conn(app)?);
        }
        f(guard.as_ref().expect("just set"))
    }
}

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

#[derive(Serialize)]
pub struct GenreRowDto {
    canonical_id: String,
    name: String,
    album_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LovedDto {
    track_ids: Vec<String>,
    album_ids: Vec<String>,
    track_album_ids: Vec<String>,
}

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

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // tauri-plugin-sql resolves "sqlite:canon.db" against app_config_dir, not
    // app_data_dir (confirmed in its wrapper.rs `DbPool::connect`) - must match.
    app.path()
        .app_config_dir()
        .map(|d| d.join("canon.db"))
        .map_err(|e| e.to_string())
}

fn open_read_conn(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    // Opened READ_WRITE despite only ever running SELECTs. canon.db is in WAL mode
    // (src/db/migrations.ts), and a SQLITE_OPEN_READ_ONLY connection cannot create or
    // recover the -wal/-shm shared-memory files - it can only attach to ones a writer
    // already owns. Since this connection can open before the tauri-plugin-sql writer
    // pool has established them, READ_ONLY makes every query here fail with
    // SQLITE_READONLY / "unable to open database file" depending on launch ordering.
    // READ_WRITE lets it participate in WAL normally. CREATE is deliberately omitted so
    // a missing/misresolved path errors out instead of silently creating an empty db
    // that would shadow the real one.
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "cache_size", -64_000)
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

// Mirrors ORDER_BY in src/hooks/useAlbums.ts - kept as a server-side allowlist
// since `sort` crosses the JS/Rust boundary as a plain string.
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
    let order = order_by_clause(&sort)?;

    state.with_conn(&app, |conn| {
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
            let placeholders = canonical_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
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
    })
}

#[tauri::command]
pub fn get_artists(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<ArtistRowDto>, String> {
    state.with_conn(&app, |conn| {
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
                SELECT artist, server_id, artwork_url
                FROM albums
                WHERE artwork_url IS NOT NULL
                GROUP BY artist, server_id
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
    })
}

#[tauri::command]
pub fn get_all_tracks(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<AllTrackRowDto>, String> {
    state.with_conn(&app, |conn| {
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
    })
}

#[tauri::command]
pub fn get_tracks(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
    album_id: String,
) -> Result<Vec<TrackRowDto>, String> {
    state.with_conn(&app, |conn| {
        let sql = "SELECT id, title, artist, album_artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count, bit_rate, suffix, file_size, replay_gain_track_gain, replay_gain_track_peak, replay_gain_album_gain, replay_gain_album_peak
            FROM tracks
            WHERE album_id = ?
            ORDER BY disc_number, track_number";
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&album_id], |row| {
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
    })
}

// Leaf (direct) canon-tree genres for the library filter sidebar. Mirrors the query
// that used to live in src/hooks/useGenres.ts; raw: synthetic ids stay excluded.
#[tauri::command]
pub fn get_genres(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<GenreRowDto>, String> {
    state.with_conn(&app, |conn| {
        let sql = "SELECT canonical_id, name, COUNT(DISTINCT album_id) AS album_count
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
    })
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
    state.with_conn(&app, |conn| {
        let recent_sql = "WITH recent_albums AS (
                SELECT t.album_id, MAX(sh.scrobbled_at) AS last_played
                FROM scrobble_history sh
                JOIN tracks t ON t.id = sh.track_id
                GROUP BY t.album_id
                ORDER BY last_played DESC
                LIMIT 10
            )
            SELECT ag.canonical_id, ag.name, COUNT(DISTINCT ag.album_id) AS album_count
            FROM recent_albums ra
            JOIN album_genres ag ON ag.album_id = ra.album_id
            WHERE ag.relation = 'direct'
              AND ag.canonical_id NOT LIKE 'raw:%'
            GROUP BY ag.canonical_id
            HAVING (
              SELECT COUNT(DISTINCT ag2.album_id) FROM album_genres ag2
              WHERE ag2.canonical_id = ag.canonical_id AND ag2.relation = 'direct'
            ) >= 5
            ORDER BY MAX(ra.last_played) DESC";
        let mut stmt = conn.prepare(recent_sql).map_err(|e| e.to_string())?;
        let recent = stmt
            .query_map([], map_genre_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !recent.is_empty() {
            return Ok(recent);
        }

        let fallback_sql = "SELECT canonical_id, name, COUNT(DISTINCT album_id) AS album_count
             FROM album_genres
             WHERE relation = 'direct' AND canonical_id NOT LIKE 'raw:%'
             GROUP BY canonical_id
             HAVING COUNT(DISTINCT album_id) >= 5
             ORDER BY album_count DESC
             LIMIT 18";
        let mut stmt = conn.prepare(fallback_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_genre_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

// All three loved-id sets in one round trip. useLoved is mounted by ~8 components at
// once, so the previous shape (3 sqlx selects per call site) multiplied badly.
#[tauri::command]
pub fn get_loved(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<LovedDto, String> {
    state.with_conn(&app, |conn| {
        let collect_ids = |sql: &str| -> Result<Vec<String>, String> {
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(rows)
        };
        Ok(LovedDto {
            track_ids: collect_ids("SELECT track_id FROM loved_tracks")?,
            album_ids: collect_ids("SELECT album_id FROM loved_albums")?,
            track_album_ids: collect_ids(
                "SELECT DISTINCT t.album_id FROM tracks t
                 INNER JOIN loved_tracks lt ON lt.track_id = t.id
                 WHERE t.album_id IS NOT NULL",
            )?,
        })
    })
}

#[tauri::command]
pub fn get_playlists(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<PlaylistRowDto>, String> {
    state.with_conn(&app, |conn| {
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
    })
}

// Scalar replacement for the full useTagVocab payload at app root, which existed only
// to compute this badge number. Reproduces the JS predicate exactly:
// !canonical_id && album_count > 0. The UNION ALL arm of the vocab query always has
// album_count = 0, so it can never satisfy the predicate and is dropped here.
#[tauri::command]
pub fn get_unmapped_tag_count(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<i64, String> {
    state.with_conn(&app, |conn| {
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
    })
}

#[cfg(test)]
mod tests {
    use super::order_by_clause;

    #[test]
    fn each_allowlisted_sort_key_maps_to_its_own_order_by_fragment() {
        assert_eq!(
            order_by_clause("artist").unwrap(),
            "a.artist COLLATE NOCASE, a.name COLLATE NOCASE"
        );
        assert_eq!(order_by_clause("alphabetical").unwrap(), "a.name COLLATE NOCASE");
        assert_eq!(order_by_clause("year").unwrap(), "a.year DESC, a.name COLLATE NOCASE");
        assert_eq!(
            order_by_clause("recently_added").unwrap(),
            "COALESCE(a.navidrome_created, a.created_at) DESC"
        );
    }

    #[test]
    fn an_unknown_sort_key_is_rejected_and_named_in_the_error() {
        let err = order_by_clause("popularity").expect_err("unknown keys must not fall through");
        assert!(err.contains("popularity"), "error should name the offending key: {err}");
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
}
