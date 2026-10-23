pub mod control;
pub mod playback;
pub mod visualizer;
pub mod waveform;

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::cpal::{BufferSize, ErrorKind};
use rodio::decoder::DecoderError;
use rodio::mixer::Mixer;
use rodio::{Decoder, DeviceSinkBuilder, DeviceSinkError, MixerDeviceSink, Player};
use std::collections::HashMap;
use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
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

/// How far the speakers trail what the player has pulled: the buffer the stream actually got,
/// which differs from `OUTPUT_BUFFER_MS` when the explicit-buffer open fell back.
pub(crate) fn output_lead(buffer_size: &BufferSize, sample_rate: u32) -> Duration {
    match buffer_size {
        BufferSize::Fixed(frames) if sample_rate > 0 => {
            Duration::from_secs_f64(f64::from(*frames) / f64::from(sample_rate))
        }
        _ => Duration::from_millis(u64::from(OUTPUT_BUFFER_MS)),
    }
}

/// Errors after which the output stream produces no more sound; the rest are glitches it survives.
fn output_error_is_fatal(kind: ErrorKind) -> bool {
    !matches!(
        kind,
        ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied
    )
}

/// Opens the default output with an explicit buffer; failing that, the device's other configs.
/// A fatal stream error sets `output_lost`, since rodio's players never drain once it dies.
pub(crate) fn open_output(
    output_lost: Arc<AtomicBool>,
) -> Result<MixerDeviceSink, DeviceSinkError> {
    let on_error = move |e: rodio::cpal::Error| {
        eprintln!("Audio output error: {e}");
        if output_error_is_fatal(e.kind()) {
            output_lost.store(true, Ordering::Release);
        }
    };
    let device = rodio::cpal::default_host()
        .default_output_device()
        .ok_or(DeviceSinkError::NoDevice)?;
    let with_explicit_buffer = || {
        let config = device
            .default_output_config()
            .map_err(DeviceSinkError::DefaultSinkConfigError)?;
        DeviceSinkBuilder::default()
            .with_device(device.clone())
            .with_supported_config(&config)
            .with_buffer_size(BufferSize::Fixed(output_buffer_frames(
                config.sample_rate(),
            )))
            .with_error_callback(on_error.clone())
            .open_stream()
    };
    with_explicit_buffer().or_else(|e| {
        eprintln!(
            "Audio output with explicit buffer failed ({e}); trying the device's other configs"
        );
        DeviceSinkBuilder::from_device(device.clone())?
            .with_error_callback(on_error.clone())
            .open_sink_or_fallback()
    })
}

/// rodio's plain `Decoder::new` marks the reader unseekable, so every backward seek fails.
pub(crate) fn open_decoder<R>(reader: R, byte_len: Option<u64>) -> Result<Decoder<R>, DecoderError>
where
    R: Read + Seek + Send + Sync + 'static,
{
    let builder = Decoder::builder().with_data(reader).with_seekable(true);
    match byte_len {
        Some(len) => builder.with_byte_len(len).build(),
        None => builder.build(),
    }
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
    // Set by the output stream's error callback once it can no longer play anything.
    pub(crate) output_lost: Arc<AtomicBool>,
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
    // State of the latest queued gapless source, so audio_withdraw_next can skip it before it plays.
    pub(crate) gapless_handoff: Arc<Mutex<Option<Arc<AtomicU8>>>>,
    pub(crate) visualizer: Arc<visualizer::VisualizerTap>,
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
    fn only_a_dead_stream_counts_as_a_lost_output() {
        assert!(output_error_is_fatal(ErrorKind::DeviceNotAvailable));
        assert!(output_error_is_fatal(ErrorKind::HostUnavailable));
        assert!(output_error_is_fatal(ErrorKind::StreamInvalidated));
        assert!(!output_error_is_fatal(ErrorKind::Xrun));
        assert!(!output_error_is_fatal(ErrorKind::DeviceChanged));
        assert!(!output_error_is_fatal(ErrorKind::RealtimeDenied));
    }

    #[test]
    fn the_lead_is_the_buffer_the_stream_got() {
        assert_eq!(
            output_lead(&BufferSize::Fixed(2_205), 44_100),
            Duration::from_millis(50)
        );
        assert_eq!(
            output_lead(&BufferSize::Fixed(4_800), 48_000),
            Duration::from_millis(100)
        );
        assert_eq!(
            output_lead(&BufferSize::Default, 44_100),
            Duration::from_millis(100)
        );
        assert_eq!(
            output_lead(&BufferSize::Fixed(2_205), 0),
            Duration::from_millis(100)
        );
    }

    #[test]
    fn output_buffer_is_never_zero() {
        assert_eq!(output_buffer_frames(0), 1);
    }
}
