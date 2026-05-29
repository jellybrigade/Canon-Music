use keyring::Entry;
use rodio::{Decoder, OutputStreamHandle, Sink};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client")
}

struct PosTracker {
    play_start: Option<Instant>,
    offset: f64,
}

impl PosTracker {
    fn current(&self) -> f64 {
        match self.play_start {
            Some(t) => self.offset + t.elapsed().as_secs_f64(),
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
    // URL → pre-fetched bytes. Populated by audio_prefetch; consumed (and cleared) by audio_play.
    prefetch_cache: Arc<Mutex<HashMap<String, Vec<u8>>>>,
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
    // before sleep_until_end() returns, preventing a spurious track-ended event.
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

    // Take cached bytes if available; clear remaining stale entries.
    let cached_bytes = {
        let mut cache = state.prefetch_cache.lock().unwrap();
        let hit = cache.remove(&url);
        cache.clear();
        hit
    };

    // Download and decode on a blocking thread so audio_play returns immediately.
    // rodio's Decoder requires Read+Seek; HTTP responses are not seekable, so we
    // buffer via bytes(). If bytes were pre-fetched, skip the download entirely.
    std::thread::spawn(move || {
        let bytes: Vec<u8> = if let Some(b) = cached_bytes {
            b
        } else {
            match http_client().get(&url).send().and_then(|r| r.bytes()) {
                Ok(b) => b.to_vec(),
                Err(e) => { eprintln!("audio_play fetch error: {e}"); return; }
            }
        };

        // A newer play arrived while downloading — discard.
        if play_id_arc.load(Ordering::Relaxed) != this_id {
            return;
        }

        let source = match Decoder::new(Cursor::new(bytes)) {
            Ok(s) => s,
            Err(e) => { eprintln!("audio_play decode error: {e}"); return; }
        };
        let sink = match Sink::try_new(&handle) {
            Ok(s) => Arc::new(s),
            Err(e) => { eprintln!("audio_play sink error: {e}"); return; }
        };
        let current_volume = *volume_arc.lock().unwrap();
        sink.set_volume(current_volume);
        sink.append(source);

        {
            let mut pos = pos_arc.lock().unwrap();
            pos.offset = 0.0;
            pos.play_start = Some(Instant::now());
        }

        let play_id_watcher = Arc::clone(&play_id_arc);
        let sink_watcher = Arc::clone(&sink);
        std::thread::spawn(move || {
            sink_watcher.sleep_until_end();
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
fn audio_pause(state: tauri::State<'_, AudioState>) {
    if let Some(sink) = state.sink.lock().unwrap().as_ref() {
        sink.pause();
    }
    let mut pos = state.pos.lock().unwrap();
    if let Some(t) = pos.play_start.take() {
        pos.offset += t.elapsed().as_secs_f64();
    }
}

#[tauri::command]
fn audio_resume(state: tauri::State<'_, AudioState>) {
    if let Some(sink) = state.sink.lock().unwrap().as_ref() {
        sink.play();
    }
    let mut pos = state.pos.lock().unwrap();
    if pos.play_start.is_none() {
        pos.play_start = Some(Instant::now());
    }
}

#[tauri::command]
fn audio_stop(state: tauri::State<'_, AudioState>) {
    // Bump play_id first so the watcher thread won't emit track-ended after stop.
    state.play_id.fetch_add(1, Ordering::Relaxed);
    let old_sink = state.sink.lock().unwrap().take();
    if let Some(sink) = old_sink {
        sink.stop();
    }
    state.prefetch_cache.lock().unwrap().clear();
    let mut pos = state.pos.lock().unwrap();
    pos.play_start = None;
    pos.offset = 0.0;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .manage(AudioState {
            handle,
            sink: Arc::new(Mutex::new(None)),
            play_id: Arc::new(AtomicU64::new(0)),
            pos: Arc::new(Mutex::new(PosTracker { play_start: None, offset: 0.0 })),
            volume: Arc::new(Mutex::new(1.0_f32)),
            prefetch_cache: Arc::new(Mutex::new(HashMap::new())),
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
            audio_seek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
