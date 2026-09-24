pub mod control;
pub mod playback;
pub mod waveform;

use rodio::{OutputStreamHandle, Sink};
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
    pub(crate) handle: Option<OutputStreamHandle>,
    pub(crate) sink: Arc<Mutex<Option<Arc<Sink>>>>,
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
}
