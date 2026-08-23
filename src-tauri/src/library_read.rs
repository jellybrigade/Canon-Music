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

pub(crate) fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // tauri-plugin-sql resolves "sqlite:canon.db" against app_config_dir, not
    // app_data_dir (confirmed in its wrapper.rs `DbPool::connect`) - must match.
    app.path()
        .app_config_dir()
        .map(|d| d.join("canon.db"))
        .map_err(|e| e.to_string())
}

fn open_read_conn(app: &tauri::AppHandle) -> Result<Connection, String> {
    open_read_conn_at(&db_path(app)?)
}

fn open_read_conn_at(path: &std::path::Path) -> Result<Connection, String> {
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
        path,
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
}

// All three loved-id sets in one round trip. useLoved is mounted by ~8 components at
// once, so the previous shape (3 sqlx selects per call site) multiplied badly.
#[tauri::command]
pub fn get_loved(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<LovedDto, String> {
    state.with_conn(&app, query_loved)
}

fn query_loved(conn: &Connection) -> Result<LovedDto, String> {
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
}

#[tauri::command]
pub fn get_playlists(
    app: tauri::AppHandle,
    state: tauri::State<LibraryReadStore>,
) -> Result<Vec<PlaylistRowDto>, String> {
    state.with_conn(&app, query_playlists)
}

fn query_playlists(conn: &Connection) -> Result<Vec<PlaylistRowDto>, String> {
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
    use rusqlite::Connection;

    const SORT_KEYS: [&str; 4] = ["artist", "alphabetical", "year", "recently_added"];

    // Hand-written DDL, post-ALTER shape, for only the tables these queries read.
    // src/db/migrations.ts owns the real schema and this connection never sees it -
    // tauri-plugin-sql migrates the file before any read command runs. Replaying 50
    // TS migrations from Rust is not possible, so this mirrors them instead; when a
    // column below is renamed there, the query tests fail with "no such column".
    const FIXTURE_DDL: &str = "
        CREATE TABLE albums (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          artist TEXT, album_artist TEXT, year INTEGER, artwork_url TEXT,
          release_type TEXT, accent_color TEXT, navidrome_created TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE tracks (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, title TEXT NOT NULL,
          artist TEXT, album_artist TEXT, album_id TEXT, genre TEXT,
          track_number INTEGER, disc_number INTEGER, year INTEGER, duration INTEGER,
          file_path TEXT, play_count INTEGER, bit_rate INTEGER, suffix TEXT,
          file_size INTEGER,
          replay_gain_track_gain REAL, replay_gain_track_peak REAL,
          replay_gain_album_gain REAL, replay_gain_album_peak REAL
        );
        CREATE TABLE artists (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          album_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE artist_identity (
          artist_name TEXT PRIMARY KEY, lastfm_image_url TEXT,
          wikidata_image_url TEXT, navidrome_image_url TEXT, enriched_at INTEGER
        );
        CREATE TABLE artist_aliases (
          alias_name TEXT NOT NULL PRIMARY KEY, canonical_name TEXT NOT NULL
        );
        CREATE TABLE album_genres (
          album_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
          relation TEXT NOT NULL CHECK (relation IN ('direct','ancestor')),
          section TEXT, name TEXT NOT NULL,
          PRIMARY KEY (album_id, canonical_id)
        );
        CREATE TABLE scrobble_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL, scrobbled_at TEXT NOT NULL
        );
        CREATE TABLE loved_tracks (track_id TEXT PRIMARY KEY);
        CREATE TABLE loved_albums (album_id TEXT PRIMARY KEY);
        CREATE TABLE playlists (
          id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL,
          comment TEXT, track_count INTEGER, cover_art_url TEXT,
          custom_cover_data TEXT, is_smart INTEGER, rules_json TEXT
        );
        CREATE TABLE tag_vocab_cache (
          norm_value TEXT NOT NULL, raw_value TEXT NOT NULL, kind TEXT NOT NULL,
          album_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (norm_value, kind)
        );
        CREATE TABLE tag_mappings (
          raw_value TEXT NOT NULL, kind TEXT NOT NULL, canonical_id TEXT NOT NULL,
          norm_value TEXT, PRIMARY KEY (raw_value, kind)
        );
    ";

    fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(FIXTURE_DDL).expect("fixture ddl");
        conn
    }

    /// `(id, server_id, name, artist)`, everything else NULL.
    fn insert_album(conn: &Connection, id: &str, server: &str, name: &str, artist: &str) {
        conn.execute(
            "INSERT INTO albums (id, server_id, name, artist) VALUES (?, ?, ?, ?)",
            [id, server, name, artist],
        )
        .expect("insert album");
    }

    fn insert_genre(conn: &Connection, album_id: &str, canonical_id: &str, relation: &str) {
        conn.execute(
            "INSERT INTO album_genres (album_id, canonical_id, relation, name)
             VALUES (?, ?, ?, ?)",
            [album_id, canonical_id, relation, canonical_id],
        )
        .expect("insert album_genre");
    }

    fn ids(rows: &[AlbumRowDto]) -> Vec<&str> {
        rows.iter().map(|r| r.id.as_str()).collect()
    }

    fn genre_ids(rows: &[GenreRowDto]) -> Vec<&str> {
        rows.iter().map(|r| r.canonical_id.as_str()).collect()
    }

    // ── order_by_clause ───────────────────────────────────────────────────────

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

    // ── open_read_conn_at ─────────────────────────────────────────────────────

    /// Unique scratch dir per test, removed on drop. Avoids pulling in `tempfile`
    /// as a dev-dependency (same reasoning as lib.rs and streaming.rs).
    struct ScratchDir(std::path::PathBuf);

    impl ScratchDir {
        fn new(label: &str) -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "canon-library-read-test-{label}-{}-{n}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch dir");
            ScratchDir(dir)
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_missing_database_file_errors_instead_of_being_created() {
        let scratch = ScratchDir::new("no-create");
        let path = scratch.0.join("canon.db");

        let err = open_read_conn_at(&path).expect_err("a missing db must not open");

        assert!(!err.is_empty(), "error must be reported, not swallowed");
        assert!(
            !path.exists(),
            "SQLITE_OPEN_CREATE is deliberately omitted - an empty db here would \
             shadow the real one instead of failing loudly"
        );
    }

    #[test]
    fn an_existing_database_opens_read_write_so_it_can_participate_in_wal() {
        let scratch = ScratchDir::new("wal");
        let path = scratch.0.join("canon.db");
        {
            let writer = Connection::open(&path).expect("writer");
            writer
                .pragma_update(None, "journal_mode", "WAL")
                .expect("wal");
            writer
                .execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('x')")
                .expect("seed");
        }

        let conn = open_read_conn_at(&path).expect("existing db must open");
        let v: String = conn
            .query_row("SELECT v FROM t", [], |r| r.get(0))
            .expect("read back");
        assert_eq!(v, "x");
        // READ_ONLY is the flag that broke this once: it cannot recover a -wal/-shm
        // pair the writer pool has not established yet.
        assert!(
            conn.execute("INSERT INTO t VALUES ('y')", []).is_ok(),
            "connection is opened READ_WRITE by design, even though it issues no writes"
        );
    }

    // ── query_albums ──────────────────────────────────────────────────────────

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

    // ── query_artists ─────────────────────────────────────────────────────────

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

    // ── query_all_tracks / query_tracks ───────────────────────────────────────

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

    // ── query_genres ──────────────────────────────────────────────────────────

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

    // ── query_recent_genres ───────────────────────────────────────────────────

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

    // ── query_loved ───────────────────────────────────────────────────────────

    #[test]
    fn loved_returns_track_ids_album_ids_and_the_albums_reachable_from_loved_tracks() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO tracks (id, server_id, title, album_id) VALUES
               ('s1:t1', 's1', 'A', 's1:al1'),
               ('s1:t2', 's1', 'B', 's1:al1'),
               ('s1:t3', 's1', 'C', NULL);
             INSERT INTO loved_tracks (track_id) VALUES ('s1:t1'), ('s1:t2'), ('s1:t3');
             INSERT INTO loved_albums (album_id) VALUES ('s1:al9')",
        )
        .expect("seed");

        let loved = query_loved(&conn).expect("query");
        assert_eq!(loved.track_ids.len(), 3);
        assert_eq!(loved.album_ids, ["s1:al9"]);
        assert_eq!(
            loved.track_album_ids,
            ["s1:al1"],
            "DISTINCT collapses the two tracks; the NULL album_id track is excluded"
        );
    }

    #[test]
    fn loved_is_empty_rather_than_erroring_on_an_untouched_library() {
        let conn = fixture_conn();
        let loved = query_loved(&conn).expect("query");
        assert!(loved.track_ids.is_empty());
        assert!(loved.album_ids.is_empty());
        assert!(loved.track_album_ids.is_empty());
    }

    #[test]
    fn a_loved_track_that_no_longer_exists_contributes_no_album() {
        let conn = fixture_conn();
        conn.execute("INSERT INTO loved_tracks (track_id) VALUES ('s1:gone')", [])
            .expect("seed");

        let loved = query_loved(&conn).expect("query");
        assert_eq!(loved.track_ids, ["s1:gone"]);
        assert!(loved.track_album_ids.is_empty());
    }

    // ── query_playlists ───────────────────────────────────────────────────────

    #[test]
    fn each_playlist_row_reports_the_server_id_stored_on_that_row() {
        let conn = fixture_conn();
        conn.execute_batch(
            "INSERT INTO playlists (id, server_id, name, track_count, is_smart) VALUES
               ('s1:p', 's1', 'Alpha', 3, 0),
               ('s2:p', 's2', 'Beta',  1, 0)",
        )
        .expect("seed");

        let rows = query_playlists(&conn).expect("query");
        let owners: Vec<(&str, &str)> = rows
            .iter()
            .map(|r| (r.id.as_str(), r.server_id.as_str()))
            .collect();
        assert_eq!(owners, [("s1:p", "s1"), ("s2:p", "s2")]);
    }

    #[test]
    fn a_playlist_with_null_track_count_or_is_smart_reads_as_zero() {
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO playlists (id, server_id, name, track_count, is_smart)
             VALUES ('s1:p', 's1', 'Legacy', NULL, NULL)",
            [],
        )
        .expect("seed");

        let rows = query_playlists(&conn).expect("query");
        assert_eq!(rows[0].track_count, 0);
        assert_eq!(rows[0].is_smart, 0);
    }

    #[test]
    fn canon_owned_playlist_columns_are_returned_alongside_the_server_owned_ones() {
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO playlists
               (id, server_id, name, comment, track_count, cover_art_url, custom_cover_data,
                is_smart, rules_json)
             VALUES ('s1:p','s1','Smart','note',4,'art://x','data:png',1,'{\"a\":1}')",
            [],
        )
        .expect("seed");

        let p = &query_playlists(&conn).expect("query")[0];
        assert_eq!(p.comment.as_deref(), Some("note"));
        assert_eq!(p.cover_art_url.as_deref(), Some("art://x"));
        assert_eq!(p.custom_cover_data.as_deref(), Some("data:png"));
        assert_eq!(p.is_smart, 1);
        assert_eq!(p.rules_json.as_deref(), Some("{\"a\":1}"));
    }

    // ── query_unmapped_tag_count ──────────────────────────────────────────────

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
