pub mod control;
pub mod playback;
pub mod waveform;

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::cpal::BufferSize;
use rodio::mixer::Mixer;
use rodio::{DeviceSinkBuilder, DeviceSinkError, MixerDeviceSink, Player};
use std::collections::HashMap;
use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Combines Read + Seek + Send into a single object-safe trait so we can
/// box either a Cursor (prefetch cache hit) or a StreamingBuffer (live fetch).
pub(crate) trait AudioReader: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> AudioReader for T {}

pub(crate) fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client")
}

pub(crate) fn http_client_long() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("failed to build HTTP client")
}

// Headroom against underruns while the machine is busy (the ALSA plugin's default was too small).
// Pause, volume and seek reach the speakers this much later, which a music player can afford.
const OUTPUT_BUFFER_MS: u32 = 100;

fn output_buffer_frames(sample_rate: u32) -> u32 {
    (sample_rate * OUTPUT_BUFFER_MS / 1000).max(1)
}

/// Opens the default output with an explicit buffer; failing that, rodio's own device fallback.
pub(crate) fn open_output() -> Result<MixerDeviceSink, DeviceSinkError> {
    let with_explicit_buffer = || {
        let device = rodio::cpal::default_host()
            .default_output_device()
            .ok_or(DeviceSinkError::NoDevice)?;
        let sample_rate = device
            .default_output_config()
            .map_err(DeviceSinkError::DefaultSinkConfigError)?
            .sample_rate();
        DeviceSinkBuilder::from_device(device)?
            .with_buffer_size(BufferSize::Fixed(output_buffer_frames(sample_rate)))
            .open_stream()
    };
    with_explicit_buffer().or_else(|e| {
        eprintln!("Audio output with explicit buffer failed ({e}); trying rodio defaults");
        DeviceSinkBuilder::open_default_sink()
    })
}

pub(crate) struct PosTracker {
    pub(crate) play_start: Option<Instant>,
    pub(crate) offset: f64,
    pub(crate) speed: f32,
}

impl PosTracker {
    fn current(&self) -> f64 {
        match self.play_start {
            Some(t) => self.offset + t.elapsed().as_secs_f64() * self.speed as f64,
            None => self.offset,
        }
    }
}

pub(crate) struct AudioState {
    pub(crate) mixer: Option<Mixer>,
    pub(crate) sink: Arc<Mutex<Option<Arc<Player>>>>,
    pub(crate) play_id: Arc<AtomicU64>,
    pub(crate) pos: Arc<Mutex<PosTracker>>,
    pub(crate) volume: Arc<Mutex<f32>>,
    pub(crate) speed: Arc<Mutex<f32>>,
    // URL → pre-fetched bytes. Populated by audio_prefetch; consumed (and cleared) by audio_play.
    pub(crate) prefetch_cache: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    // Bumped on every pause/resume to cancel in-flight fade threads.
    pub(crate) fade_gen: Arc<AtomicU64>,
    // True from audio_pause until the next resume/play/stop. The pause fade thread checks this
    // rather than fade_gen when it reaches its final sink.pause(), so an unrelated fade_gen bump
    // (audio_seek, audio_volume) cancels the volume ramp without also cancelling the pause itself.
    pub(crate) pause_pending: Arc<AtomicBool>,
    // Set when a next track has been appended for gapless playback; cleared on transition or explicit play.
    pub(crate) gapless_queued: Arc<AtomicBool>,
    // play_id under which playback reached the queued gapless source; 0 once the watcher reports it.
    pub(crate) gapless_started: Arc<AtomicU64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_buffer_holds_the_same_time_at_any_sample_rate() {
        assert_eq!(output_buffer_frames(44_100), 4_410);
        assert_eq!(output_buffer_frames(48_000), 4_800);
        assert_eq!(output_buffer_frames(96_000), 9_600);
    }

    #[test]
    fn output_buffer_is_never_zero() {
        assert_eq!(output_buffer_frames(0), 1);
    }
}
