use super::{http_client, http_client_long, AudioReader, AudioState};
use crate::stream_classify::{classify_stream_response, StreamVerdict, STREAM_HEAD_BYTES};
use crate::streaming::{AnyWriter, FileBackedStreamingBuffer, StreamingBuffer};
use rodio::{Decoder, Sink, Source};
use std::io::{Cursor, Read};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[tauri::command]
pub async fn audio_play(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioState>,
    url: String,
) -> Result<(), String> {
    let handle = state
        .handle
        .as_ref()
        .ok_or("No audio output device available")?
        .clone();

    // Bump play_id BEFORE stopping old sink so the watcher thread sees the new id
    // before the poll loop exits, preventing a spurious track-ended event.
    let this_id = state.play_id.fetch_add(1, Ordering::Relaxed) + 1;
    // A new track cancels any pause still pending on the outgoing sink.
    state.pause_pending.store(false, Ordering::Relaxed);

    {
        let old_sink = state.sink.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(old) = old_sink {
            old.stop();
        }
    }

    {
        let mut pos = state.pos.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut cache = state
            .prefetch_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
        let spill_dir = app
            .path()
            .app_data_dir()
            .ok()
            .map(|d| d.join("stream-spill"));

        // Build reader: either from prefetch cache or a streaming HTTP response.
        let (reader, codec): (Box<dyn AudioReader>, String) = if let Some(bytes) = cached_bytes {
            (Box::new(Cursor::new(bytes)), String::new())
        } else {
            let response = match http_client().get(&url).send() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("audio_play fetch error: {e}");
                    app.emit(
                        "audio-error",
                        serde_json::json!({
                            "url": url,
                            "message": "Could not reach the server",
                            "detail": e.to_string(),
                            "retryable": true,
                        }),
                    )
                    .ok();
                    return;
                }
            };
            let status = response.status().as_u16();
            let ct = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let content_length = response.content_length();

            // reqwest treats a 404 or a 500 as a successful request, and Subsonic rides its
            // own errors on a 200 with a JSON body, so neither the status line nor the
            // content-type alone can keep an error page out of the decoder. It surfaced as a
            // bogus "unrecognised format" several seconds later, blaming the file for a stale
            // track id. Read the head first and let `classify_stream_response` name the cause.
            let mut response = response;
            let mut head: Vec<u8> = Vec::new();
            {
                let mut chunk = vec![0u8; 8192];
                while head.len() < STREAM_HEAD_BYTES {
                    if play_id_arc.load(Ordering::Relaxed) != this_id {
                        return;
                    }
                    match response.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => head.extend_from_slice(&chunk[..n]),
                        Err(e) => {
                            eprintln!("audio_play stream read error: {e}");
                            app.emit(
                                "audio-error",
                                serde_json::json!({
                                    "url": url,
                                    "message": "The connection dropped while the track was downloading",
                                    "detail": e.to_string(),
                                    "retryable": true,
                                }),
                            )
                            .ok();
                            return;
                        }
                    }
                }
            }

            let codec = match classify_stream_response(status, &ct, &head) {
                StreamVerdict::Audio { codec } => codec,
                StreamVerdict::Failure(failure) => {
                    eprintln!("audio_play rejected stream: {}", failure.message);
                    app.emit(
                        "audio-error",
                        serde_json::json!({
                            "url": url,
                            "message": failure.message,
                            "detail": failure.detail,
                            "retryable": failure.retryable,
                            // Code 70 means the server no longer knows this id, which the
                            // frontend answers by re-resolving the album rather than retrying.
                            "subsonicCode": failure.subsonic_code,
                        }),
                    )
                    .ok();
                    return;
                }
            };

            const SPILL_THRESHOLD: u64 = 64 * 1024 * 1024;
            // Unknown Content-Length (chunked transfer) defaults to spill so large
            // streams don't accumulate unbounded in RAM.
            let use_spill = content_length.is_none_or(|cl| cl > SPILL_THRESHOLD);

            let (reader_box, writer): (Box<dyn AudioReader>, AnyWriter) = if use_spill {
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

            // Stream HTTP chunks into the buffer on a dedicated thread. The head read above
            // is already off the socket, so it is handed to the writer first or the decoder
            // starts mid-file.
            let play_id_dl = Arc::clone(&play_id_arc);
            let app_dl = app.clone();
            let url_dl = url.clone();
            std::thread::spawn(move || {
                let mut chunk = vec![0u8; 65536];
                let mut writer = writer;
                let mut received: u64 = head.len() as u64;
                if !head.is_empty() && !writer.write_chunk(&head) {
                    writer.finish();
                    return;
                }
                // A read error part-way through the body, or a body that stops short of the
                // advertised Content-Length, is a truncated track. Ending the writer normally
                // would hand the decoder a clean EOF, the sink would empty, and a server dying
                // mid-track would look exactly like a track that reached its end: silently cut
                // short, then auto-advanced past, with no error anywhere.
                let mut truncated = false;
                loop {
                    if play_id_dl.load(Ordering::Relaxed) != this_id {
                        break;
                    }
                    match response.read(&mut chunk) {
                        Ok(0) => {
                            truncated = content_length.is_some_and(|len| received < len);
                            break;
                        }
                        Ok(n) => {
                            received += n as u64;
                            if !writer.write_chunk(&chunk[..n]) {
                                break;
                            }
                        }
                        Err(e) => {
                            eprintln!("audio_play stream read error: {e}");
                            truncated = true;
                            break;
                        }
                    }
                }
                // Cancellation is not a failure: a skip or a stop bumps play_id and exits the
                // loop the same way, and must not raise an error at the user.
                if truncated && play_id_dl.load(Ordering::Relaxed) == this_id {
                    writer.fail();
                    app_dl
                        .emit(
                            "audio-error",
                            serde_json::json!({
                                "url": url_dl,
                                "message": "The connection dropped while the track was downloading",
                                "retryable": true,
                            }),
                        )
                        .ok();
                } else {
                    writer.finish();
                }
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
                app.emit("audio-error", serde_json::json!({
                    "url": url,
                    "message": "This file could not be decoded. The format may be unsupported or the file may be damaged",
                    "detail": e.to_string(),
                    // Re-downloading a file the decoder cannot read produces the same result.
                    "retryable": false,
                })).ok();
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
            // Without an event here the frontend is left asserting "buffering" forever: the
            // position never leaves zero, so the stall watchdog cannot arm either.
            Err(e) => {
                eprintln!("audio_play sink error: {e}");
                app.emit(
                    "audio-error",
                    serde_json::json!({
                        "url": url,
                        "message": "The audio output device is unavailable",
                        "detail": e.to_string(),
                        "retryable": false,
                    }),
                )
                .ok();
                return;
            }
        };
        let current_volume = *volume_arc.lock().unwrap_or_else(|e| e.into_inner());
        let current_speed = *speed_arc.lock().unwrap_or_else(|e| e.into_inner());
        sink.set_volume(current_volume);
        sink.set_speed(current_speed);

        sink.append(source);

        {
            let mut pos = pos_arc.lock().unwrap_or_else(|e| e.into_inner());
            pos.offset = 0.0;
            pos.speed = current_speed;
            pos.play_start = Some(Instant::now());
        }

        app.emit(
            "audio-format",
            serde_json::json!({
                "sample_rate": sample_rate,
                "channels": channels,
                "codec": codec
            }),
        )
        .ok();

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
                        let mut pos = pos_watcher.lock().unwrap_or_else(|e| e.into_inner());
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

        *sink_arc.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    });

    Ok(())
}

/// Called by JS at ~80% of the current track. Downloads the file (or uses the
/// prefetch cache if available), decodes it, and appends it to the active sink so
/// rodio transitions without silence. Emits `track-advanced` when the current
/// source finishes and the next one begins.
#[tauri::command]
pub async fn audio_enqueue_next(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioState>,
    url: String,
) -> Result<(), String> {
    // Atomically claim the gapless slot — guards against two concurrent calls both
    // seeing false and both appending a source (TOCTOU).
    if state
        .gapless_queued
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Ok(());
    }

    let sink_arc = Arc::clone(&state.sink);
    let gapless_queued = Arc::clone(&state.gapless_queued);
    let play_id_arc = Arc::clone(&state.play_id);
    let snap_id = play_id_arc.load(Ordering::Relaxed);
    let cache_arc = Arc::clone(&state.prefetch_cache);

    std::thread::spawn(move || {
        // Releases the gapless slot and tells the frontend to stop suppressing its
        // position-based fallback advance, which is otherwise disabled for the rest of the
        // session on any bail-out path below.
        let cancel = |gq: &std::sync::atomic::AtomicBool, app: &tauri::AppHandle| {
            gq.store(false, Ordering::Release);
            app.emit("gapless-cancelled", ()).ok();
        };

        // Use prefetch cache if a concurrent audio_prefetch already downloaded this URL.
        let cached = {
            cache_arc
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&url)
        };
        let bytes = if let Some(b) = cached {
            b
        } else {
            let response = match http_client_long().get(&url).send() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("audio_enqueue_next fetch error: {e}");
                    cancel(&gapless_queued, &app);
                    return;
                }
            };
            let status = response.status().as_u16();
            let ct = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let fetched = match response.bytes() {
                Ok(b) => b.to_vec(),
                Err(e) => {
                    eprintln!("audio_enqueue_next fetch error: {e}");
                    cancel(&gapless_queued, &app);
                    return;
                }
            };
            // Silent here on purpose: the gapless path is speculative, and the same track is
            // about to go through audio_play, which reports the cause properly.
            let head = &fetched[..fetched.len().min(STREAM_HEAD_BYTES)];
            if let StreamVerdict::Failure(failure) = classify_stream_response(status, &ct, head) {
                eprintln!("audio_enqueue_next rejected stream: {}", failure.message);
                cancel(&gapless_queued, &app);
                return;
            }
            fetched
        };

        // Abort if a newer explicit play started while we were downloading.
        if play_id_arc.load(Ordering::Relaxed) != snap_id {
            cancel(&gapless_queued, &app);
            return;
        }

        let cursor = std::io::Cursor::new(bytes);
        let source = match Decoder::new(cursor) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio_enqueue_next decode error: {e}");
                cancel(&gapless_queued, &app);
                return;
            }
        };

        // Final play_id check before appending — guards against the decode
        // completing just as the user skips to a different track.
        if play_id_arc.load(Ordering::Relaxed) != snap_id {
            cancel(&gapless_queued, &app);
            return;
        }

        let sink_opt = sink_arc.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(sink) = sink_opt {
            // The current track already ran out while this download was in flight, so the
            // watcher has exited and emitted track-ended. play_id has not been bumped yet
            // (the frontend's audio_play is still an IPC round trip away), so the checks
            // above pass. Appending here would start this source on the dead sink for the
            // few milliseconds until audio_play stops it — an audible blip of the wrong
            // track start, with no watcher left to clear the gapless flag.
            if sink.empty() {
                cancel(&gapless_queued, &app);
                return;
            }
            sink.append(source);
            // Flag stays true — set in compare_exchange above; watcher clears it on transition.
        } else {
            cancel(&gapless_queued, &app);
        }
    });

    Ok(())
}

// Full track buffers, not thumbnails — cap far below MAX_COVER_CACHE_ENTRIES to bound RSS growth
// from Radio Auto-DJ's 10-track lookahead prefetching tracks that get skipped before playback.
const MAX_PREFETCH_CACHE_ENTRIES: usize = 12;

#[tauri::command]
pub async fn audio_prefetch(
    state: tauri::State<'_, AudioState>,
    url: String,
) -> Result<(), String> {
    let cache_arc = Arc::clone(&state.prefetch_cache);
    std::thread::spawn(move || {
        let response = match http_client().get(&url).send() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("audio_prefetch fetch error: {e}");
                return;
            }
        };
        let status = response.status().as_u16();
        let ct = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = match response.bytes() {
            Ok(b) => b.to_vec(),
            Err(e) => {
                eprintln!("audio_prefetch fetch error: {e}");
                return;
            }
        };
        // A cache hit in audio_play skips every check the live path makes, so an error
        // envelope stored here would reach the decoder exactly as it did before that path
        // was guarded - and it would survive the retry, since the URL is the cache key.
        let head = &bytes[..bytes.len().min(STREAM_HEAD_BYTES)];
        if let StreamVerdict::Failure(failure) = classify_stream_response(status, &ct, head) {
            eprintln!(
                "audio_prefetch discarded a non-audio response: {}",
                failure.message
            );
            return;
        }
        let mut cache = cache_arc.lock().unwrap_or_else(|e| e.into_inner());
        if cache.len() >= MAX_PREFETCH_CACHE_ENTRIES {
            cache.clear();
        }
        cache.insert(url, bytes);
    });
    Ok(())
}
