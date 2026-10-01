mod audio;
mod cover;
mod keychain;
mod library_read;
mod library_write;
mod net_probe;
mod stream_classify;
mod streaming;
mod tray;
mod upnp;
use audio::{AudioState, PosTracker};
use cover::{
    cover_error_response, handle_cover_request, CoverProxyConfig, CoverState, ImageCache,
    COVER_CACHE_DIR, MAX_COVER_REQUESTS,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tray::{build_tray_menu, TrayState};

// Set once app data dir is known (in `.setup()`); read by the panic hook, which runs
// before any AppHandle exists and can't resolve the path itself.
static CRASH_FILE_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

#[tauri::command]
fn take_crash_report() -> Option<String> {
    let path = CRASH_FILE_PATH.get()?;
    let contents = std::fs::read_to_string(path).ok()?;
    let _ = std::fs::remove_file(path);
    Some(contents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Background threads panic silently by default; log every panic so failures are
    // diagnosable instead of surfacing later as an unrelated-looking crash elsewhere.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[panic] {info}");
        // Single write on a rare event, no perf cost on the normal path. Lets the
        // frontend surface a crash report + logs in Feedback on next launch.
        if let Some(path) = CRASH_FILE_PATH.get() {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = std::fs::write(path, format!("[unix:{ts}] {info}"));
        }
    }));

    // WebKitGTK renders a native GTK overlay scrollbar (thick on hover) on top of
    // the CSS ::-webkit-scrollbar. Disable it so only the styled thin bar shows.
    #[cfg(target_os = "linux")]
    std::env::set_var("GTK_OVERLAY_SCROLLING", "0");

    // rodio 0.19's default ALSA buffer underruns under load; widen it via PipeWire/Pulse.
    // No-op on pure ALSA. Only set if unset, so it never overrides a user choice.
    #[cfg(target_os = "linux")]
    if std::env::var_os("PULSE_LATENCY_MSEC").is_none() {
        std::env::set_var("PULSE_LATENCY_MSEC", "60");
    }

    // Targeted NVIDIA quirk instead of blanket CPU-render fallback; no-op on Intel/AMD.
    // Opt out with CANON_WEBKIT_GPU_ACCEL=1.
    #[cfg(target_os = "linux")]
    if std::env::var("CANON_WEBKIT_GPU_ACCEL").is_err() {
        webkit2gtk_nvidia_quirk::apply_workaround_with_options(
            webkit2gtk_nvidia_quirk::ApplyWorkaroundOptions::default(),
        );
    }

    // Spawn a thread to own OutputStream so it stays alive for the process lifetime.
    // Non-fatal: if no audio device is available the app still opens, play commands
    // return an error instead of crashing.
    let (tx, rx) = std::sync::mpsc::sync_channel(0);
    std::thread::Builder::new()
        .name("audio-output".into())
        .spawn(move || match rodio::OutputStream::try_default() {
            Ok((_stream, handle)) => {
                let _ = tx.send(Some(handle));
                loop {
                    std::thread::park();
                }
            }
            Err(e) => {
                eprintln!("Audio output unavailable: {e}");
                let _ = tx.send(None);
            }
        })
        .expect("Failed to spawn audio thread");
    let handle = rx.recv().unwrap_or(None);

    // Served via a registered `cover://` scheme handler instead of a loopback TCP server,
    // so the thread-storm/SIGKILL bug class in known-issues.md is structurally impossible here.
    let cover_cache: ImageCache = Arc::new(Mutex::new(HashMap::new()));
    let artist_image_cache: ImageCache = Arc::new(Mutex::new(HashMap::new()));
    let cover_proxy_config: Arc<Mutex<Option<CoverProxyConfig>>> = Arc::new(Mutex::new(None));
    let cover_http_client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!(
            "Canon/",
            env!("CARGO_PKG_VERSION"),
            " ( https://github.com/jellybrigade/canon )"
        ))
        .build()
        .expect("cover proxy http client failed");

    let builder = tauri::Builder::default();

    // Second launch focuses the existing window instead of spawning a duplicate
    // process/window (doubled resource use, potential lock contention on the shared
    // SQLite DB). Release builds only so dev hot-reload relaunches aren't blocked.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));

    builder
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            let state = ctx.app_handle().state::<CoverState>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let permit = state.request_sem.clone().acquire_owned().await;
                let response = tauri::async_runtime::spawn_blocking(move || {
                    let _permit = permit;
                    handle_cover_request(&state, &request)
                })
                .await
                .unwrap_or_else(|_| cover_error_response(500));
                responder.respond(response);
            });
        })
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
            pause_pending: Arc::new(AtomicBool::new(false)),
            gapless_queued: Arc::new(AtomicBool::new(false)),
            gapless_started: Arc::new(AtomicU64::new(0)),
        })
        .manage(TrayState { close_to_tray: AtomicBool::new(false) })
        .manage(library_read::LibraryReadStore::default())
        .manage(library_write::LibraryWriteStore::default())
        .manage(CoverState {
            cache: cover_cache,
            artist_image_cache,
            proxy_config: cover_proxy_config,
            request_sem: Arc::new(tokio::sync::Semaphore::new(MAX_COVER_REQUESTS)),
            http_client: cover_http_client,
        })
        .setup(|app| {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&data_dir);
                let _ = CRASH_FILE_PATH.set(data_dir.join("crash.txt"));
                let cover_cache_dir = data_dir.join("cover-cache");
                let _ = std::fs::create_dir_all(&cover_cache_dir);
                let _ = COVER_CACHE_DIR.set(cover_cache_dir);
            }

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

            // wry doesn't wire this up itself; without it a WebProcess crash (e.g. the
            // GTK compositor race) kills the whole app instead of just reloading.
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.with_webview(|webview| {
                    use webkit2gtk::WebViewExt;
                    webview.inner().connect_web_process_terminated(|view, reason| {
                        eprintln!("[webprocess-terminated] reason={reason:?} - reloading instead of exiting");
                        view.reload();
                    });
                });
            }

            // Created hidden and shown once from on_page_load, never unmapped: mapping an
            // unpainted WebKitGTK webview, or an unmap/remap cycle, triggers the focus-loss
            // crash. Forced visible after 5s in case the frontend never loads.
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    if !w.is_visible().unwrap_or(true) {
                        eprintln!("[startup] page load never fired after 5s - showing window anyway");
                        let _ = w.show();
                    }
                });
            }

            Ok(())
        })
        .on_page_load(|window, _payload| {
            // Fires on every reload, not just the first (window is created hidden); show() on an
            // already-visible window is a no-op, and nothing hides it, so a reload can't unmap it.
            let _ = window.show();
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
            keychain::set_credential,
            keychain::get_credential,
            keychain::delete_credential,
            audio::playback::audio_play,
            audio::playback::audio_enqueue_next,
            audio::playback::audio_prefetch,
            audio::control::audio_pause,
            audio::control::audio_resume,
            audio::control::audio_stop,
            audio::control::audio_get_pos,
            audio::control::audio_volume,
            audio::control::audio_set_speed,
            audio::control::audio_seek,
            audio::waveform::audio_extract_waveform,
            upnp::discover_upnp_renderers,
            upnp::upnp_soap,
            tray::tray_update,
            tray::tray_set_visible,
            tray::tray_set_close_to_tray,
            cover::set_cover_proxy_config,
            net_probe::probe_server,
            take_crash_report,
            library_read::albums::get_albums,
            library_read::artists::get_artists,
            library_read::tracks::get_tracks,
            library_read::tracks::get_all_tracks,
            library_read::genres::get_genres,
            library_read::genres::get_recent_genres,
            library_read::loved::get_loved,
            library_read::playlists::get_playlists,
            library_read::tags::get_unmapped_tag_count,
            library_write::genre_carry::carry_genre_renames,
            library_write::genre_carry::repair_dangling_genre_id,
            library_write::playlists::playlist_remove_track,
            library_write::user_tree::delete_user_tree_node,
            library_write::track_remap::remap_track_ids,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
