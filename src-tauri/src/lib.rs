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
    // Background threads (audio watcher, download, fade, cover server) panic silently
    // by default — the thread just dies and whatever it was doing (a lock, a sink)
    // is left in a bad state with no trace. Log every panic so failures are diagnosable
    // instead of surfacing later as an unrelated-looking crash elsewhere.
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

    // Enlarge the audio output buffer to prevent ALSA underruns (choppy/robotic audio,
    // "underrun occurred") under CPU/compositor load. rodio 0.19's OutputStream::try_default
    // uses cpal's default ALSA buffer, which is small enough that the realtime callback can
    // miss its deadline when the WebProcess or a decode/download thread saturates the CPU.
    // Most modern Linux desktops route ALSA through PipeWire/PulseAudio, which honors
    // PULSE_LATENCY_MSEC to size the client buffer; setting it larger gives the callback more
    // headroom. No-op on a pure-ALSA (no Pulse/PipeWire) setup, and only set if the user
    // hasn't already chosen a value, so it never overrides an explicit override.
    #[cfg(target_os = "linux")]
    if std::env::var_os("PULSE_LATENCY_MSEC").is_none() {
        std::env::set_var("PULSE_LATENCY_MSEC", "60");
    }

    // WebKitGTK instability under GPU compositing is driver-specific, not universal.
    // The old blanket WEBKIT_DISABLE_COMPOSITING_MODE=1 forced CPU software rendering
    // on every Linux machine, making all scrolling/painting sluggish. Instead apply
    // the targeted NVIDIA quirk (dmabuf renderer / explicit-sync workarounds) that
    // psysonic uses; it is a no-op on Intel/AMD, where compositing is stable. The
    // web-process-terminated -> reload() handler below remains as the safety net.
    // Opt out with CANON_WEBKIT_GPU_ACCEL=1 to run fully unpatched.
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

    // Cache stores (bytes, content_type) so the forwarded Content-Type matches the
    // upstream image format. Served via a registered `cover://` URI scheme handler
    // (see `handle_cover_request` below) instead of a loopback TCP server - no
    // socket, so the thread-storm/SIGKILL bug class in `known-issues.md` is
    // structurally impossible here.
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

            // WebKitGTK runs the page in a separate WebProcess by design so a crash
            // there (e.g. the GTK freeze/thaw compositor race) doesn't have to take
            // the whole app down. wry doesn't wire up this signal itself, so without
            // this hook a WebProcess death currently kills the entire Tauri process.
            // Reload instead of letting it die - doesn't fix the underlying WebKitGTK
            // bug, just stops it from closing the app on the user.
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

            // The window is created hidden (`"visible": false` in tauri.conf.json) and
            // revealed from the on_page_load hook below, once the webview has content to
            // paint. Mapping an unpainted WebKitGTK webview is a startup-crash and
            // white-flash trigger; the reference project (psysonic) never maps one.
            //
            // This is NOT the reverted `cde9841` reveal, which showed the window, hid it,
            // then showed it again after first paint - that unmap/remap cycle is itself
            // the freeze/thaw race. Here the window is mapped exactly once, and never
            // unmapped.
            //
            // Safety net: if the frontend never loads (JS bundle error, dev server down),
            // on_page_load never fires and the window would stay invisible forever with
            // no way to reach it. Force it visible after 5s regardless.
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    if !w.is_visible().unwrap_or(true) {
                        eprintln!("[startup] page load never fired after 5s - showing window anyway");
                        let _ = w.show();
                    }
                });
            }

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
        .on_page_load(|window, _payload| {
            // First reveal of the window (created hidden - see the comment in setup()).
            // Fires on every navigation/reload, not just the first load, so this must be
            // idempotent: show() on an already-visible window is a no-op, and crucially
            // there is no hide() anywhere on this path, so a reload (e.g. the
            // web-process-terminated recovery above) can't unmap and remap the window.
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
