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
