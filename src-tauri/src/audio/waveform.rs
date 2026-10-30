use super::{http_client_long, open_decoder};
use crate::stream_classify::{classify_stream_response, StreamVerdict, STREAM_HEAD_BYTES};
use rodio::Source;
use std::collections::HashMap;
use std::io::{Read, Seek, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const CANCELLED: &str = "cancelled";

struct RunningEntry {
    cancelled: Arc<AtomicBool>,
    batch: Option<String>,
}

#[derive(Default)]
struct RegistryState {
    running: HashMap<String, RunningEntry>,
    /// Stopped batch -> the track it let finish. Kept for the process: an extraction of a
    /// stopped batch can still be on its way here (IPC, a busy blocking pool).
    stopped_batches: HashMap<String, Option<String>>,
}

/// Extractions running now, by track id. Cancelling flags only these, so an id cancelled after
/// its run ended can't stop a later run of the same track; a stopped batch also stops its late arrivals.
#[derive(Default)]
struct ExtractionRegistry {
    state: Mutex<RegistryState>,
}

impl ExtractionRegistry {
    fn begin(&self, track_id: &str, batch: Option<&str>) -> Arc<AtomicBool> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let is_stopped = batch
            .and_then(|batch| state.stopped_batches.get(batch))
            .is_some_and(|kept| kept.as_deref() != Some(track_id));
        let cancelled = Arc::new(AtomicBool::new(is_stopped));
        state.running.insert(
            track_id.to_string(),
            RunningEntry {
                cancelled: cancelled.clone(),
                batch: batch.map(str::to_string),
            },
        );
        cancelled
    }

    fn end(&self, track_id: &str, flag: &Arc<AtomicBool>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state
            .running
            .get(track_id)
            .is_some_and(|entry| Arc::ptr_eq(&entry.cancelled, flag))
        {
            state.running.remove(track_id);
        }
    }

    fn stop_batch(&self, batch: &str, keep_track_id: Option<&str>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state
            .stopped_batches
            .insert(batch.to_string(), keep_track_id.map(str::to_string));
        for (id, entry) in &state.running {
            if entry.batch.as_deref() == Some(batch) && Some(id.as_str()) != keep_track_id {
                entry.cancelled.store(true, Ordering::Release);
            }
        }
    }
}

static EXTRACTIONS: LazyLock<ExtractionRegistry> = LazyLock::new(ExtractionRegistry::default);

/// Removes the run from the registry on every exit path.
struct RunningExtraction<'a> {
    registry: &'a ExtractionRegistry,
    track_id: String,
    cancelled: Arc<AtomicBool>,
}

impl<'a> RunningExtraction<'a> {
    fn start(registry: &'a ExtractionRegistry, track_id: &str, batch: Option<&str>) -> Self {
        let cancelled = registry.begin(track_id, batch);
        Self {
            registry,
            track_id: track_id.to_string(),
            cancelled,
        }
    }
}

impl Drop for RunningExtraction<'_> {
    fn drop(&mut self) {
        self.registry.end(&self.track_id, &self.cancelled);
    }
}

/// Stops every extraction started with `batch`, now or later, except `keep_track_id`'s.
#[tauri::command]
pub fn audio_stop_waveform_batch(batch: String, keep_track_id: Option<String>) {
    EXTRACTIONS.stop_batch(&batch, keep_track_id.as_deref());
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
    batch: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        const BUCKET_COUNT: usize = 200;

        let run = RunningExtraction::start(&EXTRACTIONS, &track_id, batch.as_deref());
        let cancelled = run.cancelled.clone();
        let cancelled_dl = cancelled.clone();

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
                let mut chunk = vec![0u8; 64 * 1024];
                loop {
                    if cancelled_dl.load(Ordering::Acquire) {
                        return Err(CANCELLED.to_string());
                    }
                    match response.read(&mut chunk) {
                        Ok(0) => return Ok(()),
                        Ok(n) => file.write_all(&chunk[..n]).map_err(|e| e.to_string())?,
                        Err(e) => return Err(e.to_string()),
                    }
                }
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
            if size >= 65536
                || download_done.load(Ordering::Acquire)
                || cancelled.load(Ordering::Acquire)
            {
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

        let source = match open_decoder(reader, None) {
            Ok(s) => s,
            Err(e) => {
                let _ = dl_handle.join();
                let _ = std::fs::remove_file(&temp_path);
                return Err(e.to_string());
            }
        };

        let channels = source.channels().get() as usize;
        let sample_rate = source.sample_rate().get() as f64;

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
            frame_sum += sample;
            chan_idx += 1;

            if chan_idx == channels {
                let mono_val = frame_sum / channels as f32;
                frame_sum = 0.0;
                chan_idx = 0;

                bucket_sum_sq += mono_val * mono_val;
                bucket_count += 1;

                if bucket_count >= bucket_size {
                    if cancelled.load(Ordering::Acquire) {
                        break;
                    }
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

        // A cancelled download ends the decode early too; its partial peaks must not be cached.
        if cancelled.load(Ordering::Acquire) {
            let _ = dl_handle.join();
            let _ = std::fs::remove_file(&temp_path);
            return Err(CANCELLED.to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

    fn is_cancelled(flag: &Arc<AtomicBool>) -> bool {
        flag.load(Ordering::Acquire)
    }

    #[test]
    fn stopping_a_batch_flags_only_its_running_extractions_but_the_kept_one() {
        let registry = ExtractionRegistry::default();
        let a = RunningExtraction::start(&registry, "a", Some("run-1"));
        let kept = RunningExtraction::start(&registry, "k", Some("run-1"));
        let other = RunningExtraction::start(&registry, "b", Some("run-2"));
        let player = RunningExtraction::start(&registry, "p", None);
        registry.stop_batch("run-1", Some("k"));
        assert!(is_cancelled(&a.cancelled));
        assert!(!is_cancelled(&kept.cancelled));
        assert!(!is_cancelled(&other.cancelled));
        assert!(!is_cancelled(&player.cancelled));
    }

    #[test]
    fn an_extraction_of_a_stopped_batch_that_arrives_late_starts_cancelled() {
        let registry = ExtractionRegistry::default();
        registry.stop_batch("run-1", Some("k"));
        let late = RunningExtraction::start(&registry, "a", Some("run-1"));
        let kept = RunningExtraction::start(&registry, "k", Some("run-1"));
        assert!(is_cancelled(&late.cancelled));
        assert!(!is_cancelled(&kept.cancelled));
    }

    #[test]
    fn stopping_a_batch_does_not_stop_a_later_run_of_the_same_track_outside_it() {
        let registry = ExtractionRegistry::default();
        drop(RunningExtraction::start(&registry, "a", Some("run-1")));
        registry.stop_batch("run-1", None);
        let again = RunningExtraction::start(&registry, "a", None);
        assert!(!is_cancelled(&again.cancelled));
    }

    #[test]
    fn a_finished_run_leaves_a_newer_run_of_the_same_track_registered() {
        let registry = ExtractionRegistry::default();
        let first = RunningExtraction::start(&registry, "a", Some("run-1"));
        let second = RunningExtraction::start(&registry, "a", Some("run-1"));
        drop(first);
        registry.stop_batch("run-1", None);
        assert!(is_cancelled(&second.cancelled));
    }
}
