mod streaming;
mod upnp;
use streaming::{AnyWriter, FileBackedStreamingBuffer, StreamingBuffer};

/// Combines Read + Seek + Send into a single object-safe trait so we can
/// box either a Cursor (prefetch cache hit) or a StreamingBuffer (live fetch).
trait AudioReader: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> AudioReader for T {}

use keyring::Entry;
use rodio::{Decoder, OutputStreamHandle, Sink, Source};
use std::collections::HashMap;
use std::io::{Cursor, Read, Seek};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

// fetch() enforces CORS (unlike <img> tags), so every response from the loopback
// cover server — success or error — needs this header or the renderer sees an
// opaque network error instead of the real status.
fn cors_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap()
}

fn cors_empty(status: u16) -> tiny_http::Response<std::io::Empty> {
    tiny_http::Response::empty(tiny_http::StatusCode(status)).with_header(cors_header())
}

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client")
}

fn http_client_long() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("failed to build HTTP client")
}

/// Wraps a growing temp file so the decoder blocks instead of getting premature EOF.
/// When the download thread is still writing, checks available bytes before reading to
/// avoid hitting EOF — only waits when not enough data is available yet.
struct GrowingFileReader {
    file: std::fs::File,
    download_done: Arc<AtomicBool>,
}

impl Read for GrowingFileReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            if self.download_done.load(Ordering::Acquire) {
                return self.file.read(buf);
            }

            // Compute how many bytes are safely readable without risking EOF.
            // Leave an 8 KB margin to match Supersonic's approach.
            let current_pos = self.file.seek(std::io::SeekFrom::Current(0))?;
            let file_size = self.file.metadata().map(|m| m.len()).unwrap_or(0);
            let safe_bytes = file_size.saturating_sub(current_pos + 8192) as usize;

            if safe_bytes == 0 {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }

            let read_len = buf.len().min(safe_bytes);
            return self.file.read(&mut buf[..read_len]);
        }
    }
}

impl Seek for GrowingFileReader {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.file.seek(pos)
    }
}

struct PosTracker {
    play_start: Option<Instant>,
    offset: f64,
    speed: f32,
}

impl PosTracker {
    fn current(&self) -> f64 {
        match self.play_start {
            Some(t) => self.offset + t.elapsed().as_secs_f64() * self.speed as f64,
            None => self.offset,
        }
    }
}

struct AudioState {
    handle: Option<OutputStreamHandle>,
    sink: Arc<Mutex<Option<Arc<Sink>>>>,
    play_id: Arc<AtomicU64>,
    pos: Arc<Mutex<PosTracker>>,
    volume: Arc<Mutex<f32>>,
    speed: Arc<Mutex<f32>>,
    // URL → pre-fetched bytes. Populated by audio_prefetch; consumed (and cleared) by audio_play.
    prefetch_cache: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    // Bumped on every pause/resume to cancel in-flight fade threads.
    fade_gen: Arc<AtomicU64>,
    // Set when a next track has been appended for gapless playback; cleared on transition or explicit play.
    gapless_queued: Arc<AtomicBool>,
}

struct TrayState {
    close_to_tray: AtomicBool,
}

#[derive(Clone)]
struct CoverProxyConfig {
    base_url: String,
    auth_params: String,
}

struct CoverState {
    port: u16,
    #[allow(dead_code)] // Arc kept alive here; actual reads happen via clone in the server thread
    cache: Arc<Mutex<HashMap<String, (Vec<u8>, String)>>>,
    #[allow(dead_code)] // Arc kept alive here; actual reads happen via clone in the server thread
    artist_image_cache: Arc<Mutex<HashMap<String, (Vec<u8>, String)>>>,
    proxy_config: Arc<Mutex<Option<CoverProxyConfig>>>,
}

/// Minimal percent-decoder for the artist-image loopback route — the full source
/// URL (with its own query string) is percent-encoded into a single path segment
/// on the JS side via encodeURIComponent, so it must be decoded before re-fetching.
fn percent_decode(s: &str) -> String {
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
fn get_cover_server_port(state: tauri::State<'_, CoverState>) -> u16 {
    state.port
}

#[tauri::command]
fn set_cover_proxy_config(
    state: tauri::State<'_, CoverState>,
    base_url: String,
    auth_params: String,
) {
    *state.proxy_config.lock().unwrap() = Some(CoverProxyConfig { base_url, auth_params });
}

fn build_tray_menu<R: tauri::Runtime>(
    app: &impl tauri::Manager<R>,
    track_label: &str,
    is_playing: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    let label = if track_label.is_empty() { "Canon" } else { track_label };
    let display = if label.chars().count() > 45 {
        format!("{}…", label.chars().take(45).collect::<String>())
    } else {
        label.to_string()
    };
    let track_item = MenuItemBuilder::new(&display).enabled(false).build(app)?;
    let play_pause = MenuItemBuilder::new(if is_playing { "⏸  Pause" } else { "▶  Play" })
        .id("play_pause")
        .build(app)?;
    let next_item = MenuItemBuilder::new("⏭  Next track").id("next").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let show_item = MenuItemBuilder::new("Show Canon").id("show").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::new("Quit Canon").id("quit").build(app)?;
    MenuBuilder::new(app)
        .items(&[&track_item, &play_pause, &next_item, &sep1, &show_item, &sep2, &quit_item])
        .build()
}

#[tauri::command]
fn tray_update(app: tauri::AppHandle, title: String, is_playing: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let menu = build_tray_menu(&app, &title, is_playing).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        let tooltip = if title.is_empty() {
            "Canon".to_string()
        } else {
            format!("Canon — {title}")
        };
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    Ok(())
}

#[tauri::command]
fn tray_set_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn tray_set_close_to_tray(state: tauri::State<'_, TrayState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

// keyring's Display already includes the platform error detail; this only adds
// actionable guidance for the two variants that mean "the OS secret store itself
// is unreachable" (as opposed to NoEntry/BadEncoding/etc., which are per-entry).
// Surfaced verbatim in the UI (see App.tsx credError banner), so it's worth being
// specific here rather than showing a bare platform error code to the user.
fn friendly_keyring_error(e: keyring::Error) -> String {
    match e {
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_) => format!(
            "{e}. On Linux, make sure a Secret Service provider (e.g. gnome-keyring or KWallet) \
             is running; on macOS/Windows, check that Keychain Access / Credential Manager isn't \
             locked or blocked by a permission prompt."
        ),
        other => other.to_string(),
    }
}

#[tauri::command]
fn set_credential(service: &str, account: &str, secret: &str) -> Result<(), String> {
    Entry::new(service, account)
        .map_err(friendly_keyring_error)?
        .set_password(secret)
        .map_err(friendly_keyring_error)
}

#[tauri::command]
fn get_credential(service: &str, account: &str) -> Result<String, String> {
    Entry::new(service, account)
        .map_err(friendly_keyring_error)?
        .get_password()
        .map_err(friendly_keyring_error)
}

#[tauri::command]
fn delete_credential(service: &str, account: &str) -> Result<(), String> {
    Entry::new(service, account)
        .map_err(friendly_keyring_error)?
        .delete_credential()
        .map_err(friendly_keyring_error)
}

#[tauri::command]
async fn audio_play(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioState>,
    url: String,
) -> Result<(), String> {
    let handle = state.handle.as_ref().ok_or("No audio output device available")?.clone();

    // Bump play_id BEFORE stopping old sink so the watcher thread sees the new id
    // before the poll loop exits, preventing a spurious track-ended event.
    let this_id = state.play_id.fetch_add(1, Ordering::Relaxed) + 1;

    {
        let old_sink = state.sink.lock().unwrap().take();
        if let Some(old) = old_sink {
            old.stop();
        }
    }

    {
        let mut pos = state.pos.lock().unwrap();
        pos.play_start = None;
        pos.offset = 0.0;
    }

    let play_id_arc = Arc::clone(&state.play_id);
    let sink_arc = Arc::clone(&state.sink);
    let pos_arc = Arc::clone(&state.pos);
    let volume_arc = Arc::clone(&state.volume);
    let speed_arc = Arc::clone(&state.speed);
    let gapless_queued_arc = Arc::clone(&state.gapless_queued);

    // Reset gapless state — any pending enqueue is now stale.
    state.gapless_queued.store(false, Ordering::Relaxed);

    // Take cached bytes if available; clear remaining stale entries.
    let cached_bytes = {
        let mut cache = state.prefetch_cache.lock().unwrap();
        let hit = cache.remove(&url);
        cache.clear();
        hit
    };

    // Download and decode on a blocking thread so audio_play returns immediately.
    // Pre-fetched bytes use an in-memory Cursor (instant start). Otherwise a
    // StreamingBuffer lets the decoder start as soon as format-probing data arrives
    // (~first 64 KB), reducing initial buffering wait. Tracks >64 MiB spill to a
    // temp file in stream-spill/ to avoid accumulating large Vec<u8> in RAM.
    std::thread::spawn(move || {
        let spill_dir = app.path().app_data_dir().ok().map(|d| d.join("stream-spill"));

        // Build reader: either from prefetch cache or a streaming HTTP response.
        let (reader, codec): (Box<dyn AudioReader>, String) = if let Some(bytes) = cached_bytes {
            (Box::new(Cursor::new(bytes)), String::new())
        } else {
            let response = match http_client().get(&url).send() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("audio_play fetch error: {e}");
                    app.emit("audio-error", serde_json::json!({ "url": url, "message": e.to_string() })).ok();
                    return;
                }
            };
            let ct = response.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();
            let codec = if ct.contains("flac") { "FLAC" }
                else if ct.contains("mpeg") || ct.contains("mp3") { "MP3" }
                else if ct.contains("ogg") { "OGG" }
                else if ct.contains("aac") || ct.contains("mp4") || ct.contains("m4a") { "AAC" }
                else if ct.contains("opus") { "Opus" }
                else if ct.contains("wav") { "WAV" }
                else { "" }.to_string();
            let content_length = response.content_length();

            const SPILL_THRESHOLD: u64 = 64 * 1024 * 1024;
            // Unknown Content-Length (chunked transfer) defaults to spill so large
            // streams don't accumulate unbounded in RAM.
            let use_spill = content_length.map_or(true, |cl| cl > SPILL_THRESHOLD);

            let (reader_box, writer): (Box<dyn AudioReader>, AnyWriter) =
                if use_spill {
                    if let Some(ref dir) = spill_dir {
                        match FileBackedStreamingBuffer::new(dir, this_id, content_length) {
                            Ok((buf, w)) => (Box::new(buf), AnyWriter::File(w)),
                            Err(e) => {
                                eprintln!("stream-spill init failed ({e}); using RAM buffer");
                                let (buf, w) = StreamingBuffer::new(content_length);
                                (Box::new(buf), AnyWriter::Ram(w))
                            }
                        }
                    } else {
                        let (buf, w) = StreamingBuffer::new(content_length);
                        (Box::new(buf), AnyWriter::Ram(w))
                    }
                } else {
                    let (buf, w) = StreamingBuffer::new(content_length);
                    (Box::new(buf), AnyWriter::Ram(w))
                };

            // Stream HTTP chunks into the buffer on a dedicated thread.
            let play_id_dl = Arc::clone(&play_id_arc);
            let mut response = response;
            std::thread::spawn(move || {
                let mut chunk = vec![0u8; 65536];
                let mut writer = writer;
                loop {
                    if play_id_dl.load(Ordering::Relaxed) != this_id { break; }
                    match response.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => { if !writer.write_chunk(&chunk[..n]) { break; } }
                        Err(_) => break,
                    }
                }
                writer.finish();
            });

            (reader_box, codec)
        };

        // Check before blocking on format probing; common fast-path for rapid skips.
        if play_id_arc.load(Ordering::Relaxed) != this_id {
            return;
        }

        // Decoder::new blocks (via Condvar) until enough bytes arrive for format probing.
        let source = match Decoder::new(reader) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio_play decode error: {e}");
                app.emit("audio-error", serde_json::json!({ "url": url, "message": e.to_string() })).ok();
                return;
            }
        };

        // A newer play arrived during format probing — discard.
        if play_id_arc.load(Ordering::Relaxed) != this_id {
            return;
        }

        let channels = source.channels();
        let sample_rate = source.sample_rate();

        let sink = match Sink::try_new(&handle) {
            Ok(s) => Arc::new(s),
            Err(e) => { eprintln!("audio_play sink error: {e}"); return; }
        };
        let current_volume = *volume_arc.lock().unwrap();
        let current_speed = *speed_arc.lock().unwrap();
        sink.set_volume(current_volume);
        sink.set_speed(current_speed);

        sink.append(source);

        {
            let mut pos = pos_arc.lock().unwrap();
            pos.offset = 0.0;
            pos.speed = current_speed;
            pos.play_start = Some(Instant::now());
        }

        app.emit("audio-format", serde_json::json!({
            "sample_rate": sample_rate,
            "channels": channels,
            "codec": codec
        })).ok();

        // Poll-based watcher: checks every 100ms so it can't hang if sink never empties.
        // Also detects gapless track transitions by watching sink.len() decrease.
        let play_id_watcher = Arc::clone(&play_id_arc);
        let sink_watcher = Arc::clone(&sink);
        let gapless_queued_watcher = Arc::clone(&gapless_queued_arc);
        let pos_watcher = Arc::clone(&pos_arc);
        let app_watcher = app.clone();
        std::thread::spawn(move || {
            let mut prev_sink_len = sink_watcher.len();
            loop {
                std::thread::sleep(Duration::from_millis(100));
                if play_id_watcher.load(Ordering::Relaxed) != this_id {
                    return;
                }
                let sink_len = sink_watcher.len();
                // Gapless transition: a source was consumed (len decreased) while another is queued.
                if sink_len < prev_sink_len
                    && gapless_queued_watcher.load(Ordering::Relaxed)
                    && !sink_watcher.empty()
                {
                    gapless_queued_watcher.store(false, Ordering::Relaxed);
                    {
                        let mut pos = pos_watcher.lock().unwrap();
                        pos.offset = 0.0;
                        pos.play_start = Some(Instant::now());
                    }
                    app_watcher.emit("track-advanced", ()).ok();
                    prev_sink_len = sink_len;
                    continue;
                }
                prev_sink_len = sink_len;
                if sink_watcher.empty() {
                    break;
                }
            }
            if play_id_watcher.load(Ordering::Relaxed) == this_id {
                app_watcher.emit("track-ended", ()).ok();
            }
        });

        *sink_arc.lock().unwrap() = Some(sink);
    });

    Ok(())
}

#[tauri::command]
fn audio_get_pos(state: tauri::State<'_, AudioState>) -> f64 {
    state.pos.lock().unwrap().current()
}

#[tauri::command]
fn audio_volume(state: tauri::State<'_, AudioState>, volume: f32) {
    // Cancel any in-flight seek fade so it doesn't overwrite this new volume.
    state.fade_gen.fetch_add(1, Ordering::Relaxed);
    *state.volume.lock().unwrap() = volume;
    if let Some(sink) = state.sink.lock().unwrap().as_ref() {
        sink.set_volume(volume);
    }
}

#[tauri::command]
fn audio_set_speed(state: tauri::State<'_, AudioState>, speed: f32) {
    let clamped = speed.clamp(0.5, 2.0);
    *state.speed.lock().unwrap() = clamped;
    let sink_opt = state.sink.lock().unwrap().clone();
    if let Some(sink) = sink_opt {
        sink.set_speed(clamped);
    }
    let mut pos = state.pos.lock().unwrap();
    // Freeze offset at current real-time position, then start fresh with new speed.
    if let Some(t) = pos.play_start.take() {
        pos.offset += t.elapsed().as_secs_f64() * pos.speed as f64;
    }
    pos.speed = clamped;
    pos.play_start = Some(Instant::now());
}

#[tauri::command]
fn audio_seek(state: tauri::State<'_, AudioState>, seconds: f64) {
    let fade_gen = Arc::clone(&state.fade_gen);
    let gen = fade_gen.fetch_add(1, Ordering::Relaxed) + 1;

    let target_vol = *state.volume.lock().unwrap();
    let sink_opt = state.sink.lock().unwrap().clone();
    if let Some(sink) = sink_opt {
        sink.set_volume(0.0);
        let duration = std::time::Duration::from_secs_f64(seconds);
        if let Err(e) = sink.try_seek(duration) {
            eprintln!("audio_seek error: {e}");
            sink.set_volume(target_vol);
            return;
        }
        let mut pos = state.pos.lock().unwrap();
        pos.offset = seconds;
        pos.play_start = Some(Instant::now());
        drop(pos);

        // Ramp volume back up over 80 ms to mask any DC-offset click at the seek boundary.
        // Check gen AFTER each sleep so a concurrent seek that fires mid-sleep is seen
        // immediately on wake, preventing a partial-volume write over the new seek's mute.
        std::thread::spawn(move || {
            const STEPS: u64 = 8;
            for i in 1..=STEPS {
                std::thread::sleep(Duration::from_millis(10));
                if fade_gen.load(Ordering::Relaxed) != gen { return; }
                let t = i as f32 / STEPS as f32;
                sink.set_volume(target_vol * t);
            }
            if fade_gen.load(Ordering::Relaxed) == gen {
                sink.set_volume(target_vol);
            }
        });
    }
}

/// Appends the next track to the current sink for gapless playback.
/// Called by JS at ~80% of the current track. Downloads the file (or uses the
/// prefetch cache if available), decodes it, and appends it to the active sink so
/// rodio transitions without silence. Emits `track-advanced` when the current
/// source finishes and the next one begins.
#[tauri::command]
async fn audio_enqueue_next(state: tauri::State<'_, AudioState>, url: String) -> Result<(), String> {
    // Atomically claim the gapless slot — guards against two concurrent calls both
    // seeing false and both appending a source (TOCTOU).
    if state.gapless_queued.compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed).is_err() {
        return Ok(());
    }

    let sink_arc = Arc::clone(&state.sink);
    let gapless_queued = Arc::clone(&state.gapless_queued);
    let play_id_arc = Arc::clone(&state.play_id);
    let snap_id = play_id_arc.load(Ordering::Relaxed);
    let cache_arc = Arc::clone(&state.prefetch_cache);

    std::thread::spawn(move || {
        // Use prefetch cache if a concurrent audio_prefetch already downloaded this URL.
        let cached = { cache_arc.lock().unwrap().remove(&url) };
        let bytes = if let Some(b) = cached {
            b
        } else {
            match http_client_long().get(&url).send().and_then(|r| r.bytes()) {
                Ok(b) => b.to_vec(),
                Err(e) => {
                    eprintln!("audio_enqueue_next fetch error: {e}");
                    gapless_queued.store(false, Ordering::Release);
                    return;
                }
            }
        };

        // Abort if a newer explicit play started while we were downloading.
        if play_id_arc.load(Ordering::Relaxed) != snap_id {
            gapless_queued.store(false, Ordering::Release);
            return;
        }

        let cursor = std::io::Cursor::new(bytes);
        let source = match Decoder::new(cursor) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio_enqueue_next decode error: {e}");
                gapless_queued.store(false, Ordering::Release);
                return;
            }
        };

        // Final play_id check before appending — guards against the decode
        // completing just as the user skips to a different track.
        if play_id_arc.load(Ordering::Relaxed) != snap_id {
            gapless_queued.store(false, Ordering::Release);
            return;
        }

        let sink_opt = sink_arc.lock().unwrap().clone();
        if let Some(sink) = sink_opt {
            sink.append(source);
            // Flag stays true — set in compare_exchange above; watcher clears it on transition.
        } else {
            gapless_queued.store(false, Ordering::Release);
        }
    });

    Ok(())
}

#[tauri::command]
async fn audio_prefetch(state: tauri::State<'_, AudioState>, url: String) -> Result<(), String> {
    let cache_arc = Arc::clone(&state.prefetch_cache);
    std::thread::spawn(move || {
        match http_client().get(&url).send().and_then(|r| r.bytes()) {
            Ok(b) => { cache_arc.lock().unwrap().insert(url, b.to_vec()); }
            Err(e) => { eprintln!("audio_prefetch fetch error: {e}"); }
        }
    });
    Ok(())
}

#[tauri::command]
fn audio_pause(state: tauri::State<'_, AudioState>, fade_ms: u64) {
    let fade_gen = Arc::clone(&state.fade_gen);
    let gen = fade_gen.fetch_add(1, Ordering::Relaxed) + 1;

    let mut pos = state.pos.lock().unwrap();
    if let Some(t) = pos.play_start.take() {
        pos.offset += t.elapsed().as_secs_f64() * pos.speed as f64;
    }
    drop(pos);

    if fade_ms == 0 {
        if let Some(sink) = state.sink.lock().unwrap().as_ref() {
            sink.pause();
        }
        return;
    }

    let target_vol = *state.volume.lock().unwrap();
    let sink_opt = state.sink.lock().unwrap().clone();
    if let Some(sink) = sink_opt {
        std::thread::spawn(move || {
            let steps = (fade_ms / 10).max(1);
            for i in 1..=steps {
                if fade_gen.load(Ordering::Relaxed) != gen { return; }
                let t = i as f32 / steps as f32;
                sink.set_volume(target_vol * (1.0 - t));
                std::thread::sleep(Duration::from_millis(10));
            }
            if fade_gen.load(Ordering::Relaxed) == gen {
                sink.pause();
            }
        });
    }
}

#[tauri::command]
fn audio_resume(state: tauri::State<'_, AudioState>, fade_ms: u64) {
    let fade_gen = Arc::clone(&state.fade_gen);
    let gen = fade_gen.fetch_add(1, Ordering::Relaxed) + 1;

    let mut pos = state.pos.lock().unwrap();
    if pos.play_start.is_none() {
        pos.play_start = Some(Instant::now());
    }
    drop(pos);

    let target_vol = *state.volume.lock().unwrap();
    let sink_opt = state.sink.lock().unwrap().clone();
    if let Some(sink) = sink_opt {
        if fade_ms == 0 {
            sink.set_volume(target_vol);
            sink.play();
            return;
        }
        sink.set_volume(0.0);
        sink.play();
        std::thread::spawn(move || {
            let steps = (fade_ms / 10).max(1);
            for i in 1..=steps {
                if fade_gen.load(Ordering::Relaxed) != gen { return; }
                let t = i as f32 / steps as f32;
                sink.set_volume(target_vol * t);
                std::thread::sleep(Duration::from_millis(10));
            }
            if fade_gen.load(Ordering::Relaxed) == gen {
                sink.set_volume(target_vol);
            }
        });
    }
}

#[tauri::command]
fn audio_stop(state: tauri::State<'_, AudioState>) {
    // Bump play_id first so the watcher thread won't emit track-ended after stop.
    state.play_id.fetch_add(1, Ordering::Relaxed);
    state.fade_gen.fetch_add(1, Ordering::Relaxed);
    state.gapless_queued.store(false, Ordering::Relaxed);
    let old_sink = state.sink.lock().unwrap().take();
    if let Some(sink) = old_sink {
        sink.stop();
    }
    state.prefetch_cache.lock().unwrap().clear();
    let mut pos = state.pos.lock().unwrap();
    pos.play_start = None;
    pos.offset = 0.0;
}

#[tauri::command]
async fn audio_extract_waveform(
    app: tauri::AppHandle,
    track_id: String,
    url: String,
    duration_secs: f64,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        const BUCKET_COUNT: usize = 200;

        // Sanitize track_id for use as a filename component
        let safe_id: String = track_id
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
            .collect();
        let temp_path = std::env::temp_dir().join(format!("canon_wf_{}.tmp", safe_id));
        let temp_path_dl = temp_path.clone();

        let download_done = Arc::new(AtomicBool::new(false));
        let download_done_dl = download_done.clone();
        let download_err: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let download_err_dl = download_err.clone();

        // Stream HTTP response bytes into the temp file concurrently with analysis
        let dl_handle = std::thread::spawn(move || {
            let result = (|| -> Result<(), String> {
                let mut response = http_client_long()
                    .get(&url)
                    .send()
                    .map_err(|e| e.to_string())?;
                let mut file = std::fs::File::create(&temp_path_dl).map_err(|e| e.to_string())?;
                std::io::copy(&mut response, &mut file).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if let Err(e) = result {
                *download_err_dl.lock().unwrap() = Some(e);
            }
            download_done_dl.store(true, Ordering::Release);
        });

        // Wait until enough bytes are written for format probing (64 KB), or download finishes
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let size = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
            if size >= 65536 || download_done.load(Ordering::Acquire) {
                break;
            }
            if Instant::now() > deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        if let Some(e) = download_err.lock().unwrap().take() {
            let _ = std::fs::remove_file(&temp_path);
            return Err(e);
        }

        let reader = GrowingFileReader {
            file: match std::fs::File::open(&temp_path) {
                Ok(f) => f,
                Err(e) => {
                    let _ = dl_handle.join();
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(e.to_string());
                }
            },
            download_done: download_done.clone(),
        };

        let source = match Decoder::new(reader) {
            Ok(s) => s,
            Err(e) => {
                let _ = dl_handle.join();
                let _ = std::fs::remove_file(&temp_path);
                return Err(e.to_string());
            }
        };

        let channels = source.channels() as usize;
        let sample_rate = source.sample_rate() as f64;

        if channels == 0 {
            let _ = dl_handle.join();
            let _ = std::fs::remove_file(&temp_path);
            return Err("no audio channels".into());
        }

        // Compute bucket size from known track duration; fall back to 30-min estimate
        let estimated_frames = if duration_secs > 0.0 {
            (duration_secs * sample_rate) as usize
        } else {
            30 * 60 * 44100
        };
        let bucket_size = (estimated_frames / BUCKET_COUNT).max(1);

        const EMIT_BATCH: usize = 2; // small batch so first bars appear quickly; later bars still batched

        let mut raw_peaks: Vec<f32> = Vec::with_capacity(BUCKET_COUNT);
        let mut bucket_sum_sq = 0.0f32;
        let mut bucket_count = 0usize;
        let mut chan_idx = 0usize;
        let mut frame_sum = 0.0f32;
        let mut pending_batch: Vec<f32> = Vec::with_capacity(EMIT_BATCH);
        let mut batch_offset = 0usize;

        for sample in source {
            // Mix channels down to mono as we go
            frame_sum += sample as f32 / i16::MAX as f32;
            chan_idx += 1;

            if chan_idx == channels {
                let mono_val = frame_sum / channels as f32;
                frame_sum = 0.0;
                chan_idx = 0;

                bucket_sum_sq += mono_val * mono_val;
                bucket_count += 1;

                if bucket_count >= bucket_size {
                    let rms = (bucket_sum_sq / bucket_count as f32).sqrt();
                    raw_peaks.push(rms);
                    pending_batch.push(rms);
                    bucket_sum_sq = 0.0;
                    bucket_count = 0;

                    if pending_batch.len() >= EMIT_BATCH {
                        let _ = app.emit("waveform_chunk", serde_json::json!({
                            "track_id": track_id,
                            "offset": batch_offset,
                            "peaks": pending_batch
                        }));
                        batch_offset = raw_peaks.len();
                        pending_batch.clear();
                    }

                    if raw_peaks.len() >= BUCKET_COUNT {
                        break;
                    }
                }
            }
        }

        // Flush remaining batch
        if !pending_batch.is_empty() {
            let _ = app.emit("waveform_chunk", serde_json::json!({
                "track_id": track_id,
                "offset": batch_offset,
                "peaks": pending_batch
            }));
        }

        // Flush any partial final bucket
        if bucket_count > 0 && raw_peaks.len() < BUCKET_COUNT {
            let rms = (bucket_sum_sq / bucket_count as f32).sqrt();
            raw_peaks.push(rms);
            let _ = app.emit("waveform_chunk", serde_json::json!({
                "track_id": track_id,
                "offset": raw_peaks.len() - 1,
                "peaks": [rms]
            }));
        }
        while raw_peaks.len() < BUCKET_COUNT {
            raw_peaks.push(0.0);
        }

        // Normalize then emit complete set for caching
        let max_peak = raw_peaks.iter().cloned().fold(0.0f32, f32::max);
        if max_peak > 0.0 {
            for p in &mut raw_peaks {
                *p /= max_peak;
            }
        }
        let _ = app.emit("waveform_complete", serde_json::json!({
            "track_id": track_id,
            "peaks": raw_peaks
        }));

        let _ = dl_handle.join();
        let _ = std::fs::remove_file(&temp_path);

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn discover_upnp_renderers(timeout_ms: u64) -> Result<Vec<upnp::ResolvedRenderer>, String> {
    // Run blocking SSDP discovery + HTTP description fetches on a thread.
    tokio::task::spawn_blocking(move || upnp::discover_and_resolve(timeout_ms))
        .await
        .map_err(|e| e.to_string())?
}

static SOAP_CLIENT: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();

fn soap_client() -> &'static reqwest::blocking::Client {
    SOAP_CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("reqwest SOAP client init failed")
    })
}

#[tauri::command]
async fn upnp_soap(url: String, soap_action: String, body: String) -> Result<String, String> {
    // CORS blocks native WebView fetch() for LAN UPnP devices; proxy through Rust.
    tokio::task::spawn_blocking(move || {
        let resp = soap_client()
            .post(&url)
            .header("Content-Type", "text/xml; charset=utf-8")
            .header("SOAPAction", &soap_action)
            .body(body)
            .send()
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() && resp.status().as_u16() != 500 {
            return Err(format!("SOAP failed: {}", resp.status()));
        }
        resp.text().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK renders a native GTK overlay scrollbar (thick on hover) on top of
    // the CSS ::-webkit-scrollbar. Disable it so only the styled thin bar shows.
    #[cfg(target_os = "linux")]
    std::env::set_var("GTK_OVERLAY_SCROLLING", "0");

    // Spawn a thread to own OutputStream so it stays alive for the process lifetime.
    // Non-fatal: if no audio device is available the app still opens, play commands
    // return an error instead of crashing.
    let (tx, rx) = std::sync::mpsc::sync_channel(0);
    std::thread::Builder::new()
        .name("audio-output".into())
        .spawn(move || {
            match rodio::OutputStream::try_default() {
                Ok((_stream, handle)) => {
                    let _ = tx.send(Some(handle));
                    loop { std::thread::park(); }
                }
                Err(e) => {
                    eprintln!("Audio output unavailable: {e}");
                    let _ = tx.send(None);
                }
            }
        })
        .expect("Failed to spawn audio thread");
    let handle = rx.recv().unwrap_or(None);

    // Bind cover art proxy server on a random OS-assigned port.
    // Cache stores (bytes, content_type) so the forwarded Content-Type matches the upstream image format.
    // Cache is capped at MAX_COVER_CACHE_ENTRIES and cleared on overflow (simple, avoids LRU overhead).
    // Each request is handled in its own thread so concurrent cover art fetches don't serialize.
    const MAX_COVER_CACHE_ENTRIES: usize = 500;
    let cover_cache: Arc<Mutex<HashMap<String, (Vec<u8>, String)>>> = Arc::new(Mutex::new(HashMap::new()));
    let artist_image_cache: Arc<Mutex<HashMap<String, (Vec<u8>, String)>>> = Arc::new(Mutex::new(HashMap::new()));
    let cover_proxy_config: Arc<Mutex<Option<CoverProxyConfig>>> = Arc::new(Mutex::new(None));
    // Non-fatal: if the loopback port can't be bound (exhaustion, sandboxing,
    // platform firewall interference) cover art proxying is disabled but the
    // app still opens, matching the audio-output degradation above.
    let mut cover_port = 0u16;
    let bound = std::net::TcpListener::bind("127.0.0.1:0").and_then(|listener| {
        let port = listener.local_addr()?.port();
        tiny_http::Server::from_listener(listener, None)
            .map(|server| (server, port))
            .map_err(std::io::Error::other)
    });
    match bound {
        Ok((server, port)) => {
            cover_port = port;
            let cache_clone = Arc::clone(&cover_cache);
            let artist_image_cache_clone = Arc::clone(&artist_image_cache);
            let config_clone = Arc::clone(&cover_proxy_config);
            std::thread::Builder::new()
                .name("cover-server".into())
                .spawn(move || {
                    let client = reqwest::blocking::Client::builder()
                        .timeout(Duration::from_secs(30))
                        .user_agent(concat!(
                            "Canon/",
                            env!("CARGO_PKG_VERSION"),
                            " ( https://github.com/jellybrigade/canon )"
                        ))
                        .build()
                        .expect("cover proxy http client failed");
                    for request in server.incoming_requests() {
                        let cache_req = Arc::clone(&cache_clone);
                        let artist_image_cache_req = Arc::clone(&artist_image_cache_clone);
                        let config_req = Arc::clone(&config_clone);
                        let client_req = client.clone();
                        std::thread::spawn(move || {
                            let url = request.url().to_string();
                            if let Some(encoded) = url.strip_prefix("/artist-image/") {
                                let source_url = percent_decode(encoded);
                                if source_url.is_empty() {
                                    let _ = request.respond(cors_empty(400));
                                    return;
                                }
                                let cached = artist_image_cache_req.lock().unwrap().get(&source_url).cloned();
                                let (bytes, content_type) = if let Some(entry) = cached {
                                    entry
                                } else {
                                    match client_req.get(&source_url).send() {
                                        Ok(resp) if resp.status().is_success() => {
                                            let ct = resp
                                                .headers()
                                                .get(reqwest::header::CONTENT_TYPE)
                                                .and_then(|v| v.to_str().ok())
                                                .unwrap_or("image/jpeg")
                                                .to_string();
                                            match resp.bytes() {
                                                Ok(b) => {
                                                    let b = b.to_vec();
                                                    let mut cache = artist_image_cache_req.lock().unwrap();
                                                    if cache.len() >= MAX_COVER_CACHE_ENTRIES {
                                                        cache.clear();
                                                    }
                                                    cache.insert(source_url.clone(), (b.clone(), ct.clone()));
                                                    (b, ct)
                                                }
                                                Err(_) => {
                                                    let _ = request.respond(cors_empty(502));
                                                    return;
                                                }
                                            }
                                        }
                                        Ok(resp) => {
                                            let _ = request.respond(cors_empty(resp.status().as_u16()));
                                            return;
                                        }
                                        Err(_) => {
                                            let _ = request.respond(cors_empty(502));
                                            return;
                                        }
                                    }
                                };
                                let mut resp = tiny_http::Response::from_data(bytes);
                                if let Ok(h) = tiny_http::Header::from_bytes("Content-Type", content_type.as_str()) {
                                    resp = resp.with_header(h);
                                }
                                if let Ok(h) = tiny_http::Header::from_bytes("Cache-Control", "public, max-age=604800") {
                                    resp = resp.with_header(h);
                                }
                                resp = resp.with_header(cors_header());
                                let _ = request.respond(resp);
                                return;
                            }
                            let path_query = match url.strip_prefix("/cover/") {
                                Some(s) => s.to_string(),
                                None => {
                                    let _ = request.respond(cors_empty(404));
                                    return;
                                }
                            };
                            let (id, size) = if let Some(q) = path_query.find('?') {
                                let id = path_query[..q].to_string();
                                let size = path_query[q + 1..]
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
                                (id, size)
                            } else {
                                (path_query, 300u32)
                            };
                            let cache_key = format!("{id}:{size}");
                            let cached = cache_req.lock().unwrap().get(&cache_key).cloned();
                            let (bytes, content_type) = if let Some(entry) = cached {
                                entry
                            } else {
                                let cfg = config_req.lock().unwrap().clone();
                                match cfg {
                                    None => {
                                        let _ = request.respond(cors_empty(503));
                                        return;
                                    }
                                    Some(cfg) => {
                                        let fetch_url = format!(
                                            "{}/rest/getCoverArt?{}&id={}&size={}",
                                            cfg.base_url, cfg.auth_params, id, size
                                        );
                                        match client_req.get(&fetch_url).send() {
                                            Ok(resp) if resp.status().is_success() => {
                                                let ct = resp
                                                    .headers()
                                                    .get(reqwest::header::CONTENT_TYPE)
                                                    .and_then(|v| v.to_str().ok())
                                                    .unwrap_or("image/jpeg")
                                                    .to_string();
                                                match resp.bytes() {
                                                    Ok(b) => {
                                                        let b = b.to_vec();
                                                        let mut cache = cache_req.lock().unwrap();
                                                        if cache.len() >= MAX_COVER_CACHE_ENTRIES {
                                                            cache.clear();
                                                        }
                                                        cache.insert(cache_key, (b.clone(), ct.clone()));
                                                        (b, ct)
                                                    }
                                                    Err(_) => {
                                                        let _ = request.respond(cors_empty(502));
                                                        return;
                                                    }
                                                }
                                            }
                                            _ => {
                                                let _ = request.respond(cors_empty(502));
                                                return;
                                            }
                                        }
                                    }
                                }
                            };
                            let mut resp = tiny_http::Response::from_data(bytes);
                            if let Ok(h) = tiny_http::Header::from_bytes("Content-Type", content_type.as_str()) {
                                resp = resp.with_header(h);
                            }
                            if let Ok(h) = tiny_http::Header::from_bytes("Cache-Control", "public, max-age=604800") {
                                resp = resp.with_header(h);
                            }
                            resp = resp.with_header(cors_header());
                            let _ = request.respond(resp);
                        });
                    }
                })
                .expect("Failed to spawn cover server thread");
        }
        Err(e) => {
            eprintln!("Cover art proxy server unavailable: {e}");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AudioState {
            handle,
            sink: Arc::new(Mutex::new(None)),
            play_id: Arc::new(AtomicU64::new(0)),
            pos: Arc::new(Mutex::new(PosTracker { play_start: None, offset: 0.0, speed: 1.0 })),
            volume: Arc::new(Mutex::new(1.0_f32)),
            speed: Arc::new(Mutex::new(1.0_f32)),
            prefetch_cache: Arc::new(Mutex::new(HashMap::new())),
            fade_gen: Arc::new(AtomicU64::new(0)),
            gapless_queued: Arc::new(AtomicBool::new(false)),
        })
        .manage(TrayState { close_to_tray: AtomicBool::new(false) })
        .manage(CoverState {
            port: cover_port,
            cache: cover_cache,
            artist_image_cache,
            proxy_config: cover_proxy_config,
        })
        .setup(|app| {
            // Clean up orphaned spill files from prior crashes.
            if let Ok(spill_dir) = app.path().app_data_dir().map(|d| d.join("stream-spill")) {
                if let Ok(entries) = std::fs::read_dir(&spill_dir) {
                    for entry in entries.flatten() {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }

            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let menu = build_tray_menu(app.handle(), "Not playing", false)?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Canon")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    id => { let _ = app.emit("tray-action", id); }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            // Hidden by default; TS calls tray_set_visible when setting is on
            _tray.set_visible(false)?;

            // TEMP DISABLED for crash repro test (2026-07-05): suspected trigger for
            // the WebKitGTK focus-loss freeze/thaw crash — smooth-scrolling keeps an
            // active WebKit compositor/animation timer running, which may race the
            // freeze/thaw counter when the window unmaps on focus loss. No other
            // reference Tauri app touches webkit2gtk settings this early (during
            // setup()). If disabling this stops the crash, re-enable only via a
            // safer path (e.g. deferred until after first Focused event, or dropped
            // entirely in favor of a different kinetic-scroll approach).
            //
            // WebKitGTK only animates kinetic scroll for touch/touchpad input by
            // default; mouse-wheel scroll is stepped and feels choppy. Opt into
            // the engine's smooth-scrolling mode for wheel input too.
            // #[cfg(target_os = "linux")]
            // if let Some(w) = app.get_webview_window("main") {
            //     let _ = w.with_webview(|webview| {
            //         use webkit2gtk::WebViewExt;
            //         if let Some(settings) = webview.inner().settings() {
            //             use webkit2gtk::SettingsExt;
            //             settings.set_enable_smooth_scrolling(true);
            //         }
            //     });
            // }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.app_handle().try_state::<TrayState>() {
                    if state.close_to_tray.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_credential,
            get_credential,
            delete_credential,
            audio_play,
            audio_enqueue_next,
            audio_prefetch,
            audio_pause,
            audio_resume,
            audio_stop,
            audio_get_pos,
            audio_volume,
            audio_set_speed,
            audio_seek,
            audio_extract_waveform,
            discover_upnp_renderers,
            upnp_soap,
            tray_update,
            tray_set_visible,
            tray_set_close_to_tray,
            get_cover_server_port,
            set_cover_proxy_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
