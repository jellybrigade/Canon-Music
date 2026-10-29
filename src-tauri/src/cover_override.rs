use crate::cover::{sanitize_cache_key, CoverState};
use crate::stream_classify::is_image_response;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Navidrome album id (the part after `{server_id}:`) -> file holding the chosen cover,
/// for the active server only. Read by the `cover://` handler before any cache or fetch.
pub(crate) type CoverOverrides = Arc<Mutex<HashMap<String, PathBuf>>>;

pub(crate) static COVER_OVERRIDE_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(12);
// CAA originals reach tens of megabytes; the picker asks for a 1200px rendition, so anything
// near this size is the wrong file.
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverOverrideRow {
    server_id: String,
    album_id: String,
}

/// `al-{id}_{hex}` (or a bare `al-{id}`) -> `{id}`; anything else (a per-file `mf-` id) has no album.
pub(crate) fn album_key_of_cover_id(cover_id: &str) -> Option<&str> {
    let rest = cover_id.strip_prefix("al-")?;
    let key = match rest.rsplit_once('_') {
        Some((id, stamp)) if !stamp.is_empty() && stamp.chars().all(|c| c.is_ascii_hexdigit()) => {
            id
        }
        _ => rest,
    };
    (!key.is_empty()).then_some(key)
}

/// Album ids are stored as `{server_id}:{navidrome id}`; covers name only the latter.
pub(crate) fn album_key_of_album_id<'a>(server_id: &str, album_id: &'a str) -> &'a str {
    album_id
        .strip_prefix(server_id)
        .and_then(|rest| rest.strip_prefix(':'))
        .unwrap_or(album_id)
}

pub(crate) fn override_path(root: &Path, server_id: &str, album_id: &str) -> PathBuf {
    root.join(sanitize_cache_key("server", server_id))
        .join(sanitize_cache_key("album", album_id))
}

pub(crate) fn image_content_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        "image/jpeg"
    }
}

/// Deletes every stored cover no row names, including whole servers that are gone.
pub(crate) fn sweep_override_files(root: &Path, rows: &[CoverOverrideRow]) {
    let keep: std::collections::HashSet<PathBuf> = rows
        .iter()
        .map(|row| override_path(root, &row.server_id, &row.album_id))
        .collect();
    let Ok(servers) = std::fs::read_dir(root) else {
        return;
    };
    for server in servers.flatten() {
        let server_dir = server.path();
        let Ok(files) = std::fs::read_dir(&server_dir) else {
            continue;
        };
        for file in files.flatten() {
            if !keep.contains(&file.path()) {
                let _ = std::fs::remove_file(file.path());
            }
        }
        let _ = std::fs::remove_dir(&server_dir);
    }
}

pub(crate) fn active_overrides(
    root: &Path,
    active_server_id: Option<&str>,
    rows: &[CoverOverrideRow],
) -> HashMap<String, PathBuf> {
    let Some(active) = active_server_id else {
        return HashMap::new();
    };
    rows.iter()
        .filter(|row| row.server_id == active)
        .map(|row| {
            (
                album_key_of_album_id(active, &row.album_id).to_string(),
                override_path(root, active, &row.album_id),
            )
        })
        .collect()
}

/// The chosen cover for this cover id, if the active server has one stored.
pub(crate) fn read_override(
    overrides: &CoverOverrides,
    cover_id: &str,
) -> Option<(Vec<u8>, &'static str)> {
    let key = album_key_of_cover_id(cover_id)?;
    let path = overrides
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .cloned()?;
    let bytes = std::fs::read(path).ok()?;
    let content_type = image_content_type(&bytes);
    Some((bytes, content_type))
}

fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("cover path has no folder")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the cover folder: {e}"))?;
    let mut partial = path.as_os_str().to_owned();
    partial.push(".part");
    std::fs::write(&partial, bytes).map_err(|e| format!("Could not save the cover: {e}"))?;
    std::fs::rename(&partial, path).map_err(|e| format!("Could not save the cover: {e}"))
}

fn download_image(client: &reqwest::blocking::Client, url: &str) -> Result<Vec<u8>, String> {
    let resp = client
        .get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .map_err(|e| format!("The image could not be downloaded: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!(
            "The image host answered {}",
            resp.status().as_u16()
        ));
    }
    let declared = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let mut bytes = Vec::new();
    resp.take(MAX_COVER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("The image download broke off: {e}"))?;
    if bytes.len() as u64 > MAX_COVER_BYTES {
        return Err("The image is too large".into());
    }
    validate_cover_bytes(declared.as_deref(), &bytes)?;
    Ok(bytes)
}

pub(crate) fn validate_cover_bytes(declared: Option<&str>, bytes: &[u8]) -> Result<(), String> {
    // The declared type alone is a claim; a cover stored forever must carry an image signature.
    if bytes.is_empty() || !is_image_response(None, bytes) {
        let what = declared.unwrap_or("something unnamed");
        return Err(format!("The host sent {what}, not an image"));
    }
    Ok(())
}

/// Replaces which covers exist with what the database lists, and which the active server serves.
#[tauri::command]
pub fn sync_cover_overrides(
    state: tauri::State<'_, CoverState>,
    active_server_id: Option<String>,
    rows: Vec<CoverOverrideRow>,
) {
    let Some(root) = COVER_OVERRIDE_DIR.get() else {
        return;
    };
    sweep_override_files(root, &rows);
    *state.overrides.lock().unwrap_or_else(|e| e.into_inner()) =
        active_overrides(root, active_server_id.as_deref(), &rows);
}

/// Downloads `url`, keeps it as the album's cover and serves it from now on. Returns its type.
#[tauri::command]
pub async fn save_album_cover_override(
    state: tauri::State<'_, CoverState>,
    server_id: String,
    album_id: String,
    url: String,
) -> Result<String, String> {
    let root = COVER_OVERRIDE_DIR
        .get()
        .cloned()
        .ok_or("Canon has no data folder to keep covers in")?;
    let client = state.http_client.clone();
    let overrides = state.overrides.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = download_image(&client, &url)?;
        let path = override_path(&root, &server_id, &album_id);
        write_atomically(&path, &bytes)?;
        overrides.lock().unwrap_or_else(|e| e.into_inner()).insert(
            album_key_of_album_id(&server_id, &album_id).to_string(),
            path,
        );
        Ok(image_content_type(&bytes).to_string())
    })
    .await
    .map_err(|e| format!("Saving the cover stopped: {e}"))?
}

#[tauri::command]
pub fn clear_album_cover_override(
    state: tauri::State<'_, CoverState>,
    server_id: String,
    album_id: String,
) {
    state
        .overrides
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(album_key_of_album_id(&server_id, &album_id));
    if let Some(root) = COVER_OVERRIDE_DIR.get() {
        let _ = std::fs::remove_file(override_path(root, &server_id, &album_id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct ScratchDir(PathBuf);

    impl ScratchDir {
        fn new(label: &str) -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "canon-cover-override-test-{label}-{}-{n}",
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

    fn row(server_id: &str, album_id: &str) -> CoverOverrideRow {
        CoverOverrideRow {
            server_id: server_id.into(),
            album_id: album_id.into(),
        }
    }

    fn store(root: &Path, server_id: &str, album_id: &str, bytes: &[u8]) -> PathBuf {
        let path = override_path(root, server_id, album_id);
        write_atomically(&path, bytes).unwrap();
        path
    }

    #[test]
    fn an_album_cover_id_names_its_album_with_or_without_the_change_stamp() {
        assert_eq!(
            album_key_of_cover_id("al-4S5lrPgODegqT8ISQpKR8w_1214c1cbd78eb0b4"),
            Some("4S5lrPgODegqT8ISQpKR8w")
        );
        assert_eq!(album_key_of_cover_id("al-4S5lrPg"), Some("4S5lrPg"));
    }

    #[test]
    fn a_per_file_or_empty_cover_id_names_no_album() {
        assert_eq!(album_key_of_cover_id("mf-abc_123"), None);
        assert_eq!(album_key_of_cover_id("al-"), None);
        assert_eq!(album_key_of_cover_id("pl-xyz"), None);
    }

    #[test]
    fn a_stored_album_id_drops_its_server_prefix_to_match_the_cover_id() {
        assert_eq!(album_key_of_album_id("srv", "srv:abc"), "abc");
        assert_eq!(album_key_of_album_id("srv", "other:abc"), "other:abc");
    }

    #[test]
    fn a_chosen_cover_is_served_for_every_size_and_stamp_of_its_album() {
        let scratch = ScratchDir::new("serve");
        store(&scratch.0, "srv", "srv:abc", b"\x89PNG-bytes");
        let overrides: CoverOverrides = Arc::new(Mutex::new(active_overrides(
            &scratch.0,
            Some("srv"),
            &[row("srv", "srv:abc")],
        )));

        let (bytes, content_type) = read_override(&overrides, "al-abc_0fcc").unwrap();
        assert_eq!(bytes, b"\x89PNG-bytes");
        assert_eq!(content_type, "image/png");
        assert!(read_override(&overrides, "al-abc_ffff").is_some());
        assert!(read_override(&overrides, "al-other_0fcc").is_none());
    }

    #[test]
    fn another_servers_choice_is_not_served_for_the_active_one() {
        let scratch = ScratchDir::new("other-server");
        store(&scratch.0, "srv-b", "srv-b:abc", b"\xFF\xD8\xFFb");
        let overrides: CoverOverrides = Arc::new(Mutex::new(active_overrides(
            &scratch.0,
            Some("srv-a"),
            &[row("srv-b", "srv-b:abc")],
        )));
        assert!(read_override(&overrides, "al-abc_00").is_none());
    }

    #[test]
    fn a_cover_whose_file_is_gone_falls_through_to_the_server() {
        let scratch = ScratchDir::new("missing-file");
        let overrides: CoverOverrides = Arc::new(Mutex::new(active_overrides(
            &scratch.0,
            Some("srv"),
            &[row("srv", "srv:abc")],
        )));
        assert!(read_override(&overrides, "al-abc_00").is_none());
    }

    #[test]
    fn the_sweep_keeps_listed_covers_and_deletes_the_rest_and_gone_servers() {
        let scratch = ScratchDir::new("sweep");
        let kept = store(&scratch.0, "srv", "srv:keep", b"x");
        let dropped = store(&scratch.0, "srv", "srv:drop", b"x");
        let gone_server = store(&scratch.0, "gone", "gone:abc", b"x");

        sweep_override_files(&scratch.0, &[row("srv", "srv:keep")]);

        assert!(kept.exists());
        assert!(!dropped.exists());
        assert!(!gone_server.exists());
        assert!(!gone_server.parent().unwrap().exists());
    }

    #[test]
    fn the_sweep_on_a_missing_folder_does_nothing() {
        sweep_override_files(Path::new("/definitely/not/a/cover/override/dir"), &[]);
    }

    #[test]
    fn an_error_page_offered_as_a_cover_is_refused() {
        assert!(validate_cover_bytes(Some("text/html"), b"<html>nope</html>").is_err());
        assert!(validate_cover_bytes(Some("image/jpeg"), b"").is_err());
        assert!(validate_cover_bytes(Some("image/jpeg"), b"{\"error\":1}").is_err());
        assert!(validate_cover_bytes(None, b"\xFF\xD8\xFF\xE0").is_ok());
    }

    #[test]
    fn the_content_type_comes_from_the_bytes() {
        assert_eq!(image_content_type(b"\x89PNG\r\n"), "image/png");
        assert_eq!(image_content_type(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(image_content_type(b"\xFF\xD8\xFF"), "image/jpeg");
    }
}
