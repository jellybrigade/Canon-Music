mod streaming;
mod upnp;
use streaming::StreamingBuffer;

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
}

#[tauri::command]
fn set_credential(service: &str, account: &str, secret: &str) -> Result<(), String> {
    Entry::new(service, account)
        .map_err(|e| e.to_string())?
        .set_password(secret)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_credential(service: &str, account: &str) -> Result<String, String> {
    Entry::new(service, account)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_credential(service: &str, account: &str) -> Result<(), String> {
    Entry::new(service, account)
        .map_err(|e| e.to_string())?
        .delete_credential()
        .map_err(|e| e.to_string())
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
    // (~first 64 KB), reducing initial buffering wait. Large files still accumulate
    // in memory over time; this is not a ring buffer.
    std::thread::spawn(move || {
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
            let (buffer, writer) = StreamingBuffer::new(content_length);

            // Stream HTTP chunks into the buffer on a dedicated thread.
            let play_id_dl = Arc::clone(&play_id_arc);
            let mut response = response;
            std::thread::spawn(move || {
                let mut chunk = vec![0u8; 65536];
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

            (Box::new(buffer), codec)
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
        let play_id_watcher = Arc::clone(&play_id_arc);
        let sink_watcher = Arc::clone(&sink);
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(100));
                if play_id_watcher.load(Ordering::Relaxed) != this_id {
                    return;
                }
                if sink_watcher.empty() {
                    break;
                }
            }
            if play_id_watcher.load(Ordering::Relaxed) == this_id {
                app.emit("track-ended", ()).ok();
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
    let sink_opt = state.sink.lock().unwrap().clone();
    if let Some(sink) = sink_opt {
        let duration = std::time::Duration::from_secs_f64(seconds);
        if let Err(e) = sink.try_seek(duration) {
            eprintln!("audio_seek error: {e}");
            return;
        }
        let mut pos = state.pos.lock().unwrap();
        pos.offset = seconds;
        pos.play_start = Some(Instant::now());
    }
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
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn upnp_soap(url: String, soap_action: String, body: String) -> Result<String, String> {
    // CORS blocks native WebView fetch() for LAN UPnP devices; proxy through Rust.
    tokio::task::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
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
        })
        .invoke_handler(tauri::generate_handler![
            set_credential,
            get_credential,
            delete_credential,
            audio_play,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
