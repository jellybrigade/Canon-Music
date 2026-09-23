use crate::stream_classify::is_image_response;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub(crate) struct CoverProxyConfig {
    pub(crate) base_url: String,
    pub(crate) auth_params: String,
}

// Bounds concurrent cover-art request handling. Without this, a burst of grid
// requests (e.g. rapid sidebar view-switching) fans out unbounded work with
// no upper bound, which can thread-storm the process into an unrecoverable
// SIGKILL. Permit acquired before the blocking fetch/decode work runs.
pub(crate) const MAX_COVER_REQUESTS: usize = 16;

// In-memory cache capped at this many entries, cleared on overflow (simple,
// avoids LRU overhead). Disk cache (unbounded lookup, bounded by eviction
// sweep in `evict_disk_cache_if_needed`) backs it for cross-restart persistence.
pub(crate) const MAX_COVER_CACHE_ENTRIES: usize = 500;
pub(crate) const MAX_DISK_CACHE_ENTRIES: usize = 2000;

/// Cache key -> (image bytes, content type), shared across the scheme handler threads.
pub(crate) type ImageCache = Arc<Mutex<HashMap<String, (Vec<u8>, String)>>>;

#[derive(Clone)]
pub(crate) struct CoverState {
    pub(crate) cache: ImageCache,
    pub(crate) artist_image_cache: ImageCache,
    pub(crate) proxy_config: Arc<Mutex<Option<CoverProxyConfig>>>,
    pub(crate) request_sem: Arc<tokio::sync::Semaphore>,
    pub(crate) http_client: reqwest::blocking::Client,
}

// App-data-relative dir for the on-disk cover/artist-image cache tier. Set once in
// `.setup()` (AppHandle not available before then); read from the scheme handler.
pub(crate) static COVER_CACHE_DIR: std::sync::OnceLock<std::path::PathBuf> =
    std::sync::OnceLock::new();

/// Cache keys (cover ids, artist-image source URLs) can contain characters unsafe
/// for filenames (`/`, `:`, `?`) - replace anything outside a safe set instead of
/// hashing, so cache files stay debuggable by eye. `kind` namespaces cover vs.
/// artist-image keys into distinct filenames so a sanitized collision between
/// the two (e.g. a cover `"id:size"` key and an unrelated artist-image URL both
/// reducing to the same safe string) can't serve one type's bytes for the other.
pub(crate) fn sanitize_cache_key(kind: &str, key: &str) -> String {
    let safe: String = key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{kind}-{safe}")
}

pub(crate) fn disk_cache_read(
    dir: &std::path::Path,
    kind: &str,
    key: &str,
) -> Option<(Vec<u8>, String)> {
    let safe = sanitize_cache_key(kind, key);
    let bytes = std::fs::read(dir.join(&safe)).ok()?;
    let content_type = std::fs::read_to_string(dir.join(format!("{safe}.ct")))
        .unwrap_or_else(|_| "image/jpeg".into());
    Some((bytes, content_type))
}

pub(crate) fn disk_cache_write(
    dir: &std::path::Path,
    kind: &str,
    key: &str,
    bytes: &[u8],
    content_type: &str,
) {
    let safe = sanitize_cache_key(kind, key);
    let _ = std::fs::write(dir.join(&safe), bytes);
    let _ = std::fs::write(dir.join(format!("{safe}.ct")), content_type);
    // Full directory scan is real I/O - only worth doing once every so often
    // rather than on every single cache-miss write on the cover-serving hot path.
    static WRITE_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    if WRITE_COUNT
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        .is_multiple_of(32)
    {
        evict_disk_cache_if_needed(dir);
    }
}

/// Sweeps the disk cache down to `MAX_DISK_CACHE_ENTRIES` image entries (each with
/// its `.ct` sidecar) by deleting oldest-mtime files first, once the cap is exceeded.
/// Bounded like the in-memory cache's clear-on-overflow, just LRU-ish instead of a
/// full clear since disk persistence is the point. Called periodically (not on
/// every write) from `disk_cache_write` since it's a full directory scan.
pub(crate) fn evict_disk_cache_if_needed(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut images: Vec<(std::path::PathBuf, std::time::SystemTime)> = entries
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().ends_with(".ct"))
        .filter_map(|e| {
            e.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| (e.path(), t))
        })
        .collect();
    if images.len() <= MAX_DISK_CACHE_ENTRIES {
        return;
    }
    images.sort_by_key(|(_, mtime)| *mtime);
    let excess = images.len() - MAX_DISK_CACHE_ENTRIES;
    for (path, _) in images.into_iter().take(excess) {
        let mut sidecar = path.clone().into_os_string();
        sidecar.push(".ct");
        let _ = std::fs::remove_file(sidecar);
        let _ = std::fs::remove_file(&path);
    }
}

/// Minimal percent-decoder for the artist-image loopback route — the full source
/// URL (with its own query string) is percent-encoded into a single path segment
/// on the JS side via encodeURIComponent, so it must be decoded before re-fetching.
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn set_cover_proxy_config(
    state: tauri::State<'_, CoverState>,
    base_url: String,
    auth_params: String,
) {
    *state.proxy_config.lock().unwrap_or_else(|e| e.into_inner()) = Some(CoverProxyConfig {
        base_url,
        auth_params,
    });
}

// `getBlurredBackdrop` (src/lib/artBlur.ts) loads cover images with
// `img.crossOrigin = "anonymous"` so it can read pixels back via canvas for the
// blurred NowPlaying backdrop. Per Tauri's custom-scheme docs, cross-origin
// image/fetch loads against a registered scheme need an explicit
// Access-Control-Allow-Origin or the browser treats the canvas as tainted -
// needed on every response (including errors) or a failed fetch surfaces as an
// opaque network error instead of the real status.
pub(crate) fn cover_error_response(status: u16) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

pub(crate) fn cover_image_response(
    bytes: Vec<u8>,
    content_type: &str,
) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", content_type)
        .header("Cache-Control", "public, max-age=604800")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| cover_error_response(500))
}

/// Handles a `cover://localhost/cover/<id>?size=<n>` or `cover://localhost/artist-image/<encoded>`
/// request: in-memory cache -> on-disk cache -> upstream fetch (Navidrome or the raw artist-image
/// source URL), populating both caches on a miss. Runs on a `spawn_blocking` thread, gated by
/// `CoverState.request_sem` (see caller) - same 16-permit cap the old loopback server used.
pub(crate) fn handle_cover_request(
    state: &CoverState,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path();
    let query = request.uri().query().unwrap_or("");

    if let Some(encoded) = path.strip_prefix("/artist-image/") {
        let source_url = percent_decode(encoded);
        if source_url.is_empty() {
            return cover_error_response(400);
        }
        let cached = state
            .artist_image_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&source_url)
            .cloned();
        let (bytes, content_type) = if let Some(entry) = cached {
            entry
        } else if let Some(entry) = COVER_CACHE_DIR
            .get()
            .and_then(|dir| disk_cache_read(dir, "artist", &source_url))
        {
            let mut cache = state
                .artist_image_cache
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if cache.len() >= MAX_COVER_CACHE_ENTRIES {
                cache.clear();
            }
            cache.insert(source_url.clone(), entry.clone());
            entry
        } else {
            match state.http_client.get(&source_url).send() {
                Ok(resp) if resp.status().is_success() => {
                    let declared_ct = resp
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    // The stand-in is only what gets stored beside the bytes; the guard below
                    // is handed what the server actually declared, or nothing.
                    let ct = declared_ct
                        .clone()
                        .unwrap_or_else(|| "image/jpeg".to_string());
                    match resp.bytes() {
                        Ok(b) => {
                            let b = b.to_vec();
                            // Subsonic answers a rejected id with a 200 and a JSON envelope, and
                            // both caches below are keyed by URL, so one bad answer would be
                            // served as the artist's portrait until the cache is cleared.
                            if !is_image_response(declared_ct.as_deref(), &b) {
                                return cover_error_response(502);
                            }
                            if let Some(dir) = COVER_CACHE_DIR.get() {
                                disk_cache_write(dir, "artist", &source_url, &b, &ct);
                            }
                            let mut cache = state
                                .artist_image_cache
                                .lock()
                                .unwrap_or_else(|e| e.into_inner());
                            if cache.len() >= MAX_COVER_CACHE_ENTRIES {
                                cache.clear();
                            }
                            cache.insert(source_url.clone(), (b.clone(), ct.clone()));
                            (b, ct)
                        }
                        Err(_) => return cover_error_response(502),
                    }
                }
                Ok(resp) => return cover_error_response(resp.status().as_u16()),
                Err(_) => return cover_error_response(502),
            }
        };
        return cover_image_response(bytes, &content_type);
    }

    let id = match path.strip_prefix("/cover/") {
        Some(s) => s.to_string(),
        None => return cover_error_response(404),
    };
    let size = query
        .split('&')
        .find_map(|kv| {
            let mut parts = kv.splitn(2, '=');
            if parts.next() == Some("size") {
                parts.next().and_then(|v| v.parse::<u32>().ok())
            } else {
                None
            }
        })
        .unwrap_or(300);
    let cache_key = format!("{id}:{size}");
    let cached = state
        .cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&cache_key)
        .cloned();
    let (bytes, content_type) = if let Some(entry) = cached {
        entry
    } else if let Some(entry) = COVER_CACHE_DIR
        .get()
        .and_then(|dir| disk_cache_read(dir, "cover", &cache_key))
    {
        let mut cache = state.cache.lock().unwrap_or_else(|e| e.into_inner());
        if cache.len() >= MAX_COVER_CACHE_ENTRIES {
            cache.clear();
        }
        cache.insert(cache_key.clone(), entry.clone());
        entry
    } else {
        let cfg = state
            .proxy_config
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        match cfg {
            None => return cover_error_response(503),
            Some(cfg) => {
                let fetch_url = format!(
                    "{}/rest/getCoverArt?{}&id={}&size={}",
                    cfg.base_url, cfg.auth_params, id, size
                );
                match state.http_client.get(&fetch_url).send() {
                    Ok(resp) if resp.status().is_success() => {
                        let declared_ct = resp
                            .headers()
                            .get(reqwest::header::CONTENT_TYPE)
                            .and_then(|v| v.to_str().ok())
                            .map(str::to_string);
                        // Same stand-in, same reason: it names the cache entry, it does not
                        // testify about the body.
                        let ct = declared_ct
                            .clone()
                            .unwrap_or_else(|| "image/jpeg".to_string());
                        match resp.bytes() {
                            Ok(b) => {
                                let b = b.to_vec();
                                // Same guard as the artist branch above: the disk cache under
                                // `{id}:{size}` outlives the session, so an error envelope
                                // written here is a permanently broken cover.
                                if !is_image_response(declared_ct.as_deref(), &b) {
                                    return cover_error_response(502);
                                }
                                if let Some(dir) = COVER_CACHE_DIR.get() {
                                    disk_cache_write(dir, "cover", &cache_key, &b, &ct);
                                }
                                let mut cache =
                                    state.cache.lock().unwrap_or_else(|e| e.into_inner());
                                if cache.len() >= MAX_COVER_CACHE_ENTRIES {
                                    cache.clear();
                                }
                                cache.insert(cache_key.clone(), (b.clone(), ct.clone()));
                                (b, ct)
                            }
                            Err(_) => return cover_error_response(502),
                        }
                    }
                    _ => return cover_error_response(502),
                }
            }
        }
    };
    cover_image_response(bytes, &content_type)
}

#[cfg(test)]
mod tests {
    use super::{
        disk_cache_read, disk_cache_write, evict_disk_cache_if_needed, percent_decode,
        sanitize_cache_key, MAX_DISK_CACHE_ENTRIES,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Unique scratch dir per test, removed on drop. Avoids pulling in `tempfile`
    /// as a dev-dependency for a handful of directories.
    struct ScratchDir(PathBuf);

    impl ScratchDir {
        fn new(label: &str) -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "canon-cover-cache-test-{label}-{}-{n}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch dir");
            ScratchDir(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // ── sanitize_cache_key ────────────────────────────────────────────────────

    #[test]
    fn sanitize_cache_key_prefixes_the_kind_so_the_two_caches_cannot_collide() {
        assert_eq!(
            sanitize_cache_key("cover", "al-123:300"),
            "cover-al-123_300"
        );
        assert_ne!(
            sanitize_cache_key("cover", "same"),
            sanitize_cache_key("artist-image", "same")
        );
    }

    #[test]
    fn sanitize_cache_key_keeps_only_ascii_alphanumerics_dot_underscore_and_hyphen() {
        assert_eq!(sanitize_cache_key("k", "a.b_c-d9Z"), "k-a.b_c-d9Z");
        assert_eq!(
            sanitize_cache_key("k", "a/b?c:d&e=f #g"),
            "k-a_b_c_d_e_f__g"
        );
    }

    #[test]
    fn a_traversal_key_sanitizes_to_a_single_path_component() {
        let safe = sanitize_cache_key("cover", "../../../etc/passwd");
        assert_eq!(safe, "cover-.._.._.._etc_passwd");
        assert!(!safe.contains('/') && !safe.contains('\\'));
        assert_eq!(
            Path::new(&safe).components().count(),
            1,
            "a sanitized key must never introduce a directory hop"
        );
        // The concrete guarantee that matters: joining it stays inside the cache dir.
        let joined = Path::new("/tmp/cover-cache").join(&safe);
        assert_eq!(joined.parent(), Some(Path::new("/tmp/cover-cache")));
    }

    #[test]
    fn a_windows_style_traversal_key_also_sanitizes_to_a_single_component() {
        let safe = sanitize_cache_key("cover", r"..\..\windows\system32");
        assert_eq!(safe, "cover-.._.._windows_system32");
        assert_eq!(Path::new(&safe).components().count(), 1);
    }

    #[test]
    fn a_key_that_is_only_dot_segments_still_yields_a_usable_filename() {
        // "cover-.." and "cover-." are ordinary names, not the parent/current dir.
        for key in ["..", ".", "/", ""] {
            let safe = sanitize_cache_key("cover", key);
            let joined = Path::new("/tmp/cover-cache").join(&safe);
            assert_eq!(
                joined.parent(),
                Some(Path::new("/tmp/cover-cache")),
                "key {key:?} escaped the cache dir as {safe:?}"
            );
        }
    }

    #[test]
    fn null_bytes_in_a_key_are_replaced_so_the_filename_stays_valid() {
        let safe = sanitize_cache_key("cover", "ab\0cd\0");
        assert_eq!(safe, "cover-ab_cd_");
        assert!(!safe.contains('\0'));
    }

    #[test]
    fn control_and_whitespace_characters_in_a_key_are_replaced() {
        assert_eq!(sanitize_cache_key("k", "a\tb\nc\rd e"), "k-a_b_c_d_e");
    }

    #[test]
    fn non_ascii_characters_are_replaced_one_underscore_per_character_not_per_byte() {
        // "é" is two UTF-8 bytes but one char; per-byte mapping would give two underscores.
        assert_eq!(sanitize_cache_key("k", "Beyoncé"), "k-Beyonc_");
        assert_eq!(sanitize_cache_key("k", "日本語"), "k-___");
        assert_eq!(sanitize_cache_key("k", "Mötley Crüe"), "k-M_tley_Cr_e");
    }

    #[test]
    fn sanitize_cache_key_does_not_cap_length_so_the_output_tracks_the_input_char_count() {
        // Documents current behaviour: there is no truncation, so a pathological key
        // is passed through to the filesystem at full length. If a cap is ever added,
        // this assertion is the one that should be updated deliberately.
        let long = "a".repeat(5000);
        let safe = sanitize_cache_key("cover", &long);
        assert_eq!(safe.len(), "cover-".len() + 5000);
        assert!(safe.starts_with("cover-a"));
    }

    // ── percent_decode ────────────────────────────────────────────────────────

    #[test]
    fn percent_decode_turns_percent_20_into_a_space() {
        assert_eq!(
            percent_decode("The%20Velvet%20Underground"),
            "The Velvet Underground"
        );
    }

    #[test]
    fn percent_decode_turns_percent_2f_into_a_slash_in_either_hex_case() {
        assert_eq!(
            percent_decode("https%3A%2F%2Fhost%2Fimg.jpg"),
            "https://host/img.jpg"
        );
        assert_eq!(percent_decode("a%2fb"), "a/b");
    }

    #[test]
    fn percent_decode_leaves_an_invalid_hex_escape_untouched() {
        assert_eq!(percent_decode("100%ZZ"), "100%ZZ");
        assert_eq!(percent_decode("%GG-%2G"), "%GG-%2G");
    }

    #[test]
    fn percent_decode_leaves_a_truncated_escape_at_the_end_untouched() {
        assert_eq!(percent_decode("done%"), "done%");
        assert_eq!(percent_decode("done%2"), "done%2");
        assert_eq!(percent_decode("%"), "%");
    }

    #[test]
    fn percent_decode_reassembles_multi_byte_utf8_from_consecutive_escapes() {
        assert_eq!(percent_decode("Beyonc%C3%A9"), "Beyoncé");
        assert_eq!(percent_decode("%E6%97%A5%E6%9C%AC"), "日本");
    }

    #[test]
    fn percent_decode_passes_through_input_with_nothing_to_decode() {
        assert_eq!(percent_decode(""), "");
        assert_eq!(percent_decode("plain-ascii_123"), "plain-ascii_123");
    }

    #[test]
    fn percent_decode_replaces_bytes_that_do_not_form_valid_utf8() {
        // %FF is not a valid UTF-8 sequence; lossy decoding substitutes U+FFFD
        // rather than failing, so the route always gets a String back.
        assert_eq!(percent_decode("a%FFb"), "a\u{FFFD}b");
    }

    #[test]
    fn percent_decode_decodes_a_percent_sign_that_was_itself_encoded() {
        assert_eq!(percent_decode("50%2520"), "50%20");
    }
    // ── disk cover cache ──────────────────────────────────────────────────────

    #[test]
    fn a_disk_cache_write_is_readable_back_with_its_bytes_and_content_type() {
        let scratch = ScratchDir::new("roundtrip");
        disk_cache_write(
            scratch.path(),
            "cover",
            "al-1:300",
            b"\x89PNG-ish",
            "image/png",
        );

        let (bytes, content_type) =
            disk_cache_read(scratch.path(), "cover", "al-1:300").expect("entry just written");
        assert_eq!(bytes, b"\x89PNG-ish");
        assert_eq!(content_type, "image/png");
    }

    #[test]
    fn a_disk_cache_read_misses_for_a_key_that_was_never_written() {
        let scratch = ScratchDir::new("miss");
        assert!(disk_cache_read(scratch.path(), "cover", "nope").is_none());
    }

    #[test]
    fn the_kind_namespace_keeps_a_cover_and_an_artist_image_with_the_same_key_apart() {
        let scratch = ScratchDir::new("kinds");
        disk_cache_write(
            scratch.path(),
            "cover",
            "shared",
            b"cover-bytes",
            "image/jpeg",
        );
        disk_cache_write(
            scratch.path(),
            "artist-image",
            "shared",
            b"artist-bytes",
            "image/webp",
        );

        assert_eq!(
            disk_cache_read(scratch.path(), "cover", "shared").unwrap(),
            (b"cover-bytes".to_vec(), "image/jpeg".to_string())
        );
        assert_eq!(
            disk_cache_read(scratch.path(), "artist-image", "shared").unwrap(),
            (b"artist-bytes".to_vec(), "image/webp".to_string())
        );
    }

    #[test]
    fn a_disk_cache_read_defaults_to_jpeg_when_the_content_type_sidecar_is_missing() {
        let scratch = ScratchDir::new("no-sidecar");
        let safe = sanitize_cache_key("cover", "al-9");
        std::fs::write(scratch.path().join(&safe), b"raw").unwrap();

        let (bytes, content_type) = disk_cache_read(scratch.path(), "cover", "al-9").unwrap();
        assert_eq!(bytes, b"raw");
        assert_eq!(content_type, "image/jpeg");
    }

    #[test]
    fn a_traversal_key_writes_inside_the_cache_dir_rather_than_above_it() {
        let scratch = ScratchDir::new("traversal");
        let nested = scratch.path().join("cover-cache");
        std::fs::create_dir_all(&nested).unwrap();

        disk_cache_write(&nested, "cover", "../escaped", b"payload", "image/jpeg");

        assert!(
            !scratch.path().join("escaped").exists(),
            "sanitization must keep the write inside the cache dir"
        );
        assert_eq!(
            disk_cache_read(&nested, "cover", "../escaped").unwrap().0,
            b"payload"
        );
    }

    #[test]
    fn eviction_leaves_the_cache_untouched_while_it_is_under_the_cap() {
        let scratch = ScratchDir::new("under-cap");
        for i in 0..5 {
            disk_cache_write(
                scratch.path(),
                "cover",
                &format!("al-{i}"),
                b"x",
                "image/jpeg",
            );
        }
        evict_disk_cache_if_needed(scratch.path());

        for i in 0..5 {
            assert!(
                disk_cache_read(scratch.path(), "cover", &format!("al-{i}")).is_some(),
                "entry al-{i} must survive an under-cap sweep"
            );
        }
    }

    #[test]
    fn eviction_deletes_the_oldest_mtime_entries_and_their_sidecars_down_to_the_cap() {
        let scratch = ScratchDir::new("evict");
        let over_by = 3usize;
        let total = MAX_DISK_CACHE_ENTRIES + over_by;

        // Written directly rather than through disk_cache_write, which would fire its
        // own periodic sweep partway through and make the starting state ambiguous.
        for i in 0..total {
            let safe = sanitize_cache_key("cover", &format!("al-{i}"));
            std::fs::write(scratch.path().join(&safe), b"x").unwrap();
            std::fs::write(scratch.path().join(format!("{safe}.ct")), "image/jpeg").unwrap();
        }

        // Backdate exactly `over_by` entries so the eviction order is unambiguous
        // rather than dependent on filesystem mtime granularity.
        let ancient = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        let oldest: Vec<String> = (0..over_by).map(|i| format!("al-{i}")).collect();
        for key in &oldest {
            let safe = sanitize_cache_key("cover", key);
            let f = std::fs::OpenOptions::new()
                .write(true)
                .open(scratch.path().join(&safe))
                .unwrap();
            f.set_modified(ancient).unwrap();
        }

        evict_disk_cache_if_needed(scratch.path());

        for key in &oldest {
            assert!(
                disk_cache_read(scratch.path(), "cover", key).is_none(),
                "{key} was the oldest and should have been evicted"
            );
            let safe = sanitize_cache_key("cover", key);
            assert!(
                !scratch.path().join(format!("{safe}.ct")).exists(),
                "{key}'s content-type sidecar must be removed with its image"
            );
        }
        for i in over_by..total {
            assert!(
                disk_cache_read(scratch.path(), "cover", &format!("al-{i}")).is_some(),
                "al-{i} is within the cap and must survive"
            );
        }

        let remaining = std::fs::read_dir(scratch.path())
            .unwrap()
            .flatten()
            .filter(|e| !e.file_name().to_string_lossy().ends_with(".ct"))
            .count();
        assert_eq!(remaining, MAX_DISK_CACHE_ENTRIES);
    }

    #[test]
    fn eviction_on_an_unreadable_directory_is_a_no_op_rather_than_a_panic() {
        evict_disk_cache_if_needed(Path::new("/definitely/not/a/real/cover/cache/dir"));
    }
}
