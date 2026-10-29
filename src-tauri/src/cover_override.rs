use crate::cover::{sanitize_cache_key, CoverState, ImageCache, MAX_COVER_CACHE_ENTRIES};
use crate::stream_classify::is_image_response;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A chosen cover is served only to a URL naming its revision (when it was chosen). A URL
/// without one keeps meaning the server's cover, so the webview never caches the chosen image
/// under it, whatever order the file, the database row and the URL change land in.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StoredOverride {
    path: PathBuf,
    revision: i64,
}

#[derive(Default)]
pub(crate) struct ActiveOverrides {
    server_id: Option<String>,
    /// Navidrome album id (the part after `{server_id}:`) -> its chosen cover.
    by_album: HashMap<String, StoredOverride>,
}

/// Read by the `cover://` handler before any cache or fetch.
pub(crate) type CoverOverrides = Arc<Mutex<ActiveOverrides>>;

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
    revision: i64,
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

fn album_dir(root: &Path, server_id: &str, album_id: &str) -> PathBuf {
    root.join(sanitize_cache_key("server", server_id))
        .join(sanitize_cache_key("album", album_id))
}

/// One file per choice, so a new choice never overwrites the file a stored row still names.
pub(crate) fn override_path(
    root: &Path,
    server_id: &str,
    album_id: &str,
    revision: i64,
) -> PathBuf {
    album_dir(root, server_id, album_id).join(revision.to_string())
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

/// Deletes every stored cover no row names, including whole albums and servers that are gone.
pub(crate) fn sweep_override_files(root: &Path, rows: &[CoverOverrideRow]) {
    let keep: std::collections::HashSet<PathBuf> = rows
        .iter()
        .map(|row| override_path(root, &row.server_id, &row.album_id, row.revision))
        .collect();
    let Ok(servers) = std::fs::read_dir(root) else {
        return;
    };
    for server in servers.flatten() {
        let server_dir = server.path();
        let Ok(albums) = std::fs::read_dir(&server_dir) else {
            continue;
        };
        for album in albums.flatten() {
            let album_dir = album.path();
            let Ok(files) = std::fs::read_dir(&album_dir) else {
                let _ = std::fs::remove_file(&album_dir);
                continue;
            };
            for file in files.flatten() {
                if !keep.contains(&file.path()) {
                    let _ = std::fs::remove_file(file.path());
                }
            }
            let _ = std::fs::remove_dir(&album_dir);
        }
        let _ = std::fs::remove_dir(&server_dir);
    }
}

pub(crate) fn active_overrides(
    root: &Path,
    active_server_id: Option<&str>,
    rows: &[CoverOverrideRow],
) -> ActiveOverrides {
    let Some(active) = active_server_id else {
        return ActiveOverrides::default();
    };
    let by_album = rows
        .iter()
        .filter(|row| row.server_id == active)
        .map(|row| {
            (
                album_key_of_album_id(active, &row.album_id).to_string(),
                StoredOverride {
                    path: override_path(root, active, &row.album_id, row.revision),
                    revision: row.revision,
                },
            )
        })
        .collect();
    ActiveOverrides {
        server_id: Some(active.to_string()),
        by_album,
    }
}

/// The chosen cover for this cover id, scaled to fit `size` (0 = as stored), if the URL names
/// the revision the active server has stored. Scaled copies are kept in `cache`.
pub(crate) fn read_override(
    overrides: &CoverOverrides,
    cache: &ImageCache,
    cover_id: &str,
    size: u32,
    revision: Option<i64>,
) -> Option<(Vec<u8>, String)> {
    let key = album_key_of_cover_id(cover_id)?;
    let stored = overrides
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .by_album
        .get(key)
        .cloned()?;
    if revision != Some(stored.revision) {
        return None;
    }
    let cache_key = format!("override:{key}:{}:{size}", stored.revision);
    if let Some(entry) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&cache_key)
    {
        return Some(entry.clone());
    }
    let bytes = std::fs::read(&stored.path).ok()?;
    let (bytes, content_type) = scaled_to_fit(bytes, size);
    let entry = (bytes, content_type.to_string());
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= MAX_COVER_CACHE_ENTRIES {
        cache.clear();
    }
    cache.insert(cache_key, entry.clone());
    Some(entry)
}

// Re-encoded thumbnails stay close to what Navidrome sends for the server's covers.
const SCALED_JPEG_QUALITY: u8 = 90;

/// A chosen cover is stored at full size (up to 1200px from the picker); a 64px queue row
/// should not decode that. An image that can't be decoded or is already small enough passes as is.
pub(crate) fn scaled_to_fit(bytes: Vec<u8>, size: u32) -> (Vec<u8>, &'static str) {
    let content_type = image_content_type(&bytes);
    if size == 0 {
        return (bytes, content_type);
    }
    let Ok(decoded) = image::load_from_memory(&bytes) else {
        return (bytes, content_type);
    };
    if decoded.width() <= size && decoded.height() <= size {
        return (bytes, content_type);
    }
    let scaled = decoded.thumbnail(size, size);
    let mut out = std::io::Cursor::new(Vec::new());
    let encoded = if scaled.color().has_alpha() {
        scaled
            .write_to(&mut out, image::ImageFormat::Png)
            .map(|()| "image/png")
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, SCALED_JPEG_QUALITY)
            .encode_image(&scaled.to_rgb8())
            .map(|()| "image/jpeg")
    };
    match encoded {
        Ok(scaled_type) => (out.into_inner(), scaled_type),
        Err(_) => (bytes, content_type),
    }
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
/// The caller must not run this while a choice is being saved, or the sweep deletes its file.
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

/// Downloads `url` and keeps it as this revision's file. Nothing serves it until
/// `use_album_cover_override`, once the database row is written. Returns its type.
#[tauri::command]
pub async fn save_album_cover_override(
    state: tauri::State<'_, CoverState>,
    server_id: String,
    album_id: String,
    revision: i64,
    url: String,
) -> Result<String, String> {
    let root = COVER_OVERRIDE_DIR
        .get()
        .cloned()
        .ok_or("Canon has no data folder to keep covers in")?;
    let client = state.http_client.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = download_image(&client, &url)?;
        write_atomically(
            &override_path(&root, &server_id, &album_id, revision),
            &bytes,
        )?;
        Ok(image_content_type(&bytes).to_string())
    })
    .await
    .map_err(|e| format!("Saving the cover stopped: {e}"))?
}

/// Serves the saved revision from now on and deletes the album's earlier choices.
pub(crate) fn use_override(
    overrides: &CoverOverrides,
    root: &Path,
    server_id: &str,
    album_id: &str,
    revision: i64,
) {
    let path = override_path(root, server_id, album_id, revision);
    if let Ok(files) = std::fs::read_dir(album_dir(root, server_id, album_id)) {
        for file in files.flatten().filter(|file| file.path() != path) {
            let _ = std::fs::remove_file(file.path());
        }
    }
    let mut active = overrides.lock().unwrap_or_else(|e| e.into_inner());
    if active.server_id.as_deref() == Some(server_id) {
        active.by_album.insert(
            album_key_of_album_id(server_id, album_id).to_string(),
            StoredOverride { path, revision },
        );
    }
}

#[tauri::command]
pub fn use_album_cover_override(
    state: tauri::State<'_, CoverState>,
    server_id: String,
    album_id: String,
    revision: i64,
) {
    if let Some(root) = COVER_OVERRIDE_DIR.get() {
        use_override(&state.overrides, root, &server_id, &album_id, revision);
    }
}

/// Drops a saved revision whose database row could not be written; earlier choices stay.
#[tauri::command]
pub fn discard_album_cover_file(server_id: String, album_id: String, revision: i64) {
    if let Some(root) = COVER_OVERRIDE_DIR.get() {
        let _ = std::fs::remove_file(override_path(root, &server_id, &album_id, revision));
    }
}

#[tauri::command]
pub fn clear_album_cover_override(
    state: tauri::State<'_, CoverState>,
    server_id: String,
    album_id: String,
) {
    let mut active = state.overrides.lock().unwrap_or_else(|e| e.into_inner());
    if active.server_id.as_deref() == Some(server_id.as_str()) {
        active
            .by_album
            .remove(album_key_of_album_id(&server_id, &album_id));
    }
    drop(active);
    if let Some(root) = COVER_OVERRIDE_DIR.get() {
        let _ = std::fs::remove_dir_all(album_dir(root, &server_id, &album_id));
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

    fn row(server_id: &str, album_id: &str, revision: i64) -> CoverOverrideRow {
        CoverOverrideRow {
            server_id: server_id.into(),
            album_id: album_id.into(),
            revision,
        }
    }

    fn store(root: &Path, server_id: &str, album_id: &str, revision: i64, bytes: &[u8]) -> PathBuf {
        let path = override_path(root, server_id, album_id, revision);
        write_atomically(&path, bytes).unwrap();
        path
    }

    fn overrides_for(root: &Path, active: &str, rows: &[CoverOverrideRow]) -> CoverOverrides {
        Arc::new(Mutex::new(active_overrides(root, Some(active), rows)))
    }

    fn empty_cache() -> ImageCache {
        Arc::new(Mutex::new(HashMap::new()))
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(width, height)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
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
    fn a_chosen_cover_is_served_for_every_stamp_of_its_album_at_its_revision() {
        let scratch = ScratchDir::new("serve");
        store(&scratch.0, "srv", "srv:abc", 7, b"\x89PNG-bytes");
        let overrides = overrides_for(&scratch.0, "srv", &[row("srv", "srv:abc", 7)]);
        let cache = empty_cache();

        let (bytes, content_type) =
            read_override(&overrides, &cache, "al-abc_0fcc", 0, Some(7)).unwrap();
        assert_eq!(bytes, b"\x89PNG-bytes");
        assert_eq!(content_type, "image/png");
        assert!(read_override(&overrides, &cache, "al-abc_ffff", 0, Some(7)).is_some());
        assert!(read_override(&overrides, &cache, "al-other_0fcc", 0, Some(7)).is_none());
    }

    #[test]
    fn a_url_without_the_chosen_revision_gets_the_servers_cover() {
        let scratch = ScratchDir::new("revision");
        store(&scratch.0, "srv", "srv:abc", 7, b"\x89PNG-bytes");
        let overrides = overrides_for(&scratch.0, "srv", &[row("srv", "srv:abc", 7)]);
        let cache = empty_cache();

        assert!(read_override(&overrides, &cache, "al-abc_00", 0, None).is_none());
        assert!(read_override(&overrides, &cache, "al-abc_00", 0, Some(6)).is_none());
    }

    #[test]
    fn a_large_chosen_cover_is_scaled_to_the_requested_size_once() {
        let scratch = ScratchDir::new("scale");
        let path = store(&scratch.0, "srv", "srv:abc", 7, &png(1200, 1000));
        let overrides = overrides_for(&scratch.0, "srv", &[row("srv", "srv:abc", 7)]);
        let cache = empty_cache();

        let (bytes, content_type) =
            read_override(&overrides, &cache, "al-abc", 64, Some(7)).unwrap();
        let scaled = image::load_from_memory(&bytes).unwrap();
        assert_eq!((scaled.width(), scaled.height()), (64, 53));
        assert_eq!(content_type, "image/jpeg");

        std::fs::remove_file(path).unwrap();
        assert!(read_override(&overrides, &cache, "al-abc", 64, Some(7)).is_some());
        assert!(read_override(&overrides, &cache, "al-abc", 0, Some(7)).is_none());
    }

    #[test]
    fn a_chosen_cover_smaller_than_the_request_is_served_as_stored() {
        let original = png(100, 100);
        assert_eq!(
            scaled_to_fit(original.clone(), 300),
            (original.clone(), "image/png")
        );
        assert_eq!(
            scaled_to_fit(b"not an image".to_vec(), 64).0,
            b"not an image"
        );
    }

    #[test]
    fn another_servers_choice_is_not_served_for_the_active_one() {
        let scratch = ScratchDir::new("other-server");
        store(&scratch.0, "srv-b", "srv-b:abc", 7, b"\xFF\xD8\xFFb");
        let overrides = overrides_for(&scratch.0, "srv-a", &[row("srv-b", "srv-b:abc", 7)]);
        assert!(read_override(&overrides, &empty_cache(), "al-abc_00", 0, Some(7)).is_none());
    }

    #[test]
    fn a_cover_whose_file_is_gone_falls_through_to_the_server() {
        let scratch = ScratchDir::new("missing-file");
        let overrides = overrides_for(&scratch.0, "srv", &[row("srv", "srv:abc", 7)]);
        assert!(read_override(&overrides, &empty_cache(), "al-abc_00", 0, Some(7)).is_none());
    }

    #[test]
    fn a_saved_choice_is_served_only_once_used_and_then_replaces_the_earlier_one() {
        let scratch = ScratchDir::new("use");
        let earlier = store(&scratch.0, "srv", "srv:abc", 7, b"\xFF\xD8\xFFold");
        let overrides = overrides_for(&scratch.0, "srv", &[row("srv", "srv:abc", 7)]);
        let saved = store(&scratch.0, "srv", "srv:abc", 9, b"\xFF\xD8\xFFnew");
        let cache = empty_cache();
        assert!(read_override(&overrides, &cache, "al-abc", 0, Some(9)).is_none());

        use_override(&overrides, &scratch.0, "srv", "srv:abc", 9);

        assert_eq!(
            read_override(&overrides, &cache, "al-abc", 0, Some(9))
                .unwrap()
                .0,
            b"\xFF\xD8\xFFnew"
        );
        assert!(saved.exists());
        assert!(!earlier.exists());
    }

    #[test]
    fn using_another_servers_choice_leaves_the_active_servers_covers_alone() {
        let scratch = ScratchDir::new("use-other");
        let overrides = overrides_for(&scratch.0, "srv-a", &[]);
        store(&scratch.0, "srv-b", "srv-b:abc", 9, b"\xFF\xD8\xFF");
        use_override(&overrides, &scratch.0, "srv-b", "srv-b:abc", 9);
        assert!(read_override(&overrides, &empty_cache(), "al-abc", 0, Some(9)).is_none());
    }

    #[test]
    fn the_sweep_keeps_listed_covers_and_deletes_the_rest_and_gone_servers() {
        let scratch = ScratchDir::new("sweep");
        let kept = store(&scratch.0, "srv", "srv:keep", 1, b"x");
        let older = store(&scratch.0, "srv", "srv:keep", 0, b"x");
        let dropped = store(&scratch.0, "srv", "srv:drop", 1, b"x");
        let gone_server = store(&scratch.0, "gone", "gone:abc", 1, b"x");

        sweep_override_files(&scratch.0, &[row("srv", "srv:keep", 1)]);

        assert!(kept.exists());
        assert!(!older.exists());
        assert!(!dropped.exists());
        assert!(!dropped.parent().unwrap().exists());
        assert!(!gone_server.exists());
        assert!(!gone_server.parent().unwrap().parent().unwrap().exists());
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
