use super::http_client_long;
use crate::stream_classify::{classify_stream_response, StreamVerdict, STREAM_HEAD_BYTES};
use rodio::{Decoder, Source};
use std::io::{Read, Seek, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

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
            let current_pos = self.file.stream_position()?;
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

#[tauri::command]
pub async fn audio_extract_waveform(
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
            .map(|c| {
                if c.is_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
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
                let status = response.status().as_u16();
                let ct = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                // The decoder below would otherwise blame the file for an error envelope the
                // same way the playback path used to, only silently: the waveform just never
                // appears and nothing says why.
                let mut head = vec![0u8; STREAM_HEAD_BYTES];
                let mut filled = 0;
                while filled < head.len() {
                    match response.read(&mut head[filled..]) {
                        Ok(0) => break,
                        Ok(n) => filled += n,
                        Err(e) => return Err(e.to_string()),
                    }
                }
                head.truncate(filled);
                if let StreamVerdict::Failure(failure) =
                    classify_stream_response(status, &ct, &head)
                {
                    return Err(failure.message);
                }
                let mut file = std::fs::File::create(&temp_path_dl).map_err(|e| e.to_string())?;
                file.write_all(&head).map_err(|e| e.to_string())?;
                std::io::copy(&mut response, &mut file).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if let Err(e) = result {
                *download_err_dl.lock().unwrap_or_else(|e| e.into_inner()) = Some(e);
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

        if let Some(e) = download_err
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
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
                        let _ = app.emit(
                            "waveform_chunk",
                            serde_json::json!({
                                "track_id": track_id,
                                "offset": batch_offset,
                                "peaks": pending_batch
                            }),
                        );
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
            let _ = app.emit(
                "waveform_chunk",
                serde_json::json!({
                    "track_id": track_id,
                    "offset": batch_offset,
                    "peaks": pending_batch
                }),
            );
        }

        // Flush any partial final bucket
        if bucket_count > 0 && raw_peaks.len() < BUCKET_COUNT {
            let rms = (bucket_sum_sq / bucket_count as f32).sqrt();
            raw_peaks.push(rms);
            let _ = app.emit(
                "waveform_chunk",
                serde_json::json!({
                    "track_id": track_id,
                    "offset": raw_peaks.len() - 1,
                    "peaks": [rms]
                }),
            );
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
        let _ = app.emit(
            "waveform_complete",
            serde_json::json!({
                "track_id": track_id,
                "peaks": raw_peaks
            }),
        );

        let _ = dl_handle.join();
        let _ = std::fs::remove_file(&temp_path);

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
