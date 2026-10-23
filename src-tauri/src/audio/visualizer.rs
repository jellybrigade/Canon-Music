use super::{AudioState, OUTPUT_BUFFER_MS};
use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, TryLockError};
use std::time::{Duration, Instant};

const WINDOW_LEN: usize = 2048;
const HISTORY_LEN: usize = 8192;
// Frames gathered before taking the history lock, so the audio thread locks every few ms, not per sample.
const PUSH_BLOCK: usize = 256;
const MAX_BAND_COUNT: usize = 128;
const LOWEST_HZ: f32 = 40.0;
const HIGHEST_HZ: f32 = 16_000.0;
const FLOOR_DB: f32 = -60.0;
// Music loses energy toward the treble; without a tilt the right half of the bars barely moves.
const TILT_DB_PER_OCTAVE: f32 = 3.0;
const TILT_PIVOT_HZ: f32 = 1_000.0;
// No new samples for this long means paused or buffering, so the bars should fall, not freeze.
const STALE_AFTER: Duration = Duration::from_millis(300);

struct History {
    samples: VecDeque<f32>,
    sample_rate: u32,
    last_push: Option<Instant>,
}

struct Analyzer {
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    window_sum: f32,
    input: Vec<f32>,
    spectrum: Vec<Complex<f32>>,
}

impl Analyzer {
    fn new() -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(WINDOW_LEN);
        let window = hann_window(WINDOW_LEN);
        let window_sum = window.iter().sum();
        let input = fft.make_input_vec();
        let spectrum = fft.make_output_vec();
        Self {
            fft,
            window,
            window_sum,
            input,
            spectrum,
        }
    }

    fn magnitudes(&mut self, samples: &[f32]) -> Vec<f32> {
        for ((slot, sample), weight) in self.input.iter_mut().zip(samples).zip(&self.window) {
            *slot = sample * weight;
        }
        if self
            .fft
            .process(&mut self.input, &mut self.spectrum)
            .is_err()
        {
            return vec![0.0; self.spectrum.len()];
        }
        let scale = 2.0 / self.window_sum;
        self.spectrum.iter().map(|bin| bin.norm() * scale).collect()
    }
}

/// Mono copy of what the player has pulled lately, read by the Now Playing visualizer.
/// Copies nothing while no visualizer is on screen.
pub(crate) struct VisualizerTap {
    is_active: AtomicBool,
    output_lead_micros: AtomicU64,
    history: Mutex<History>,
    analyzer: Mutex<Option<Analyzer>>,
}

impl Default for VisualizerTap {
    fn default() -> Self {
        Self {
            is_active: AtomicBool::new(false),
            output_lead_micros: AtomicU64::new(u64::from(OUTPUT_BUFFER_MS) * 1_000),
            history: Mutex::new(History {
                samples: VecDeque::with_capacity(HISTORY_LEN),
                sample_rate: 44_100,
                last_push: None,
            }),
            analyzer: Mutex::new(None),
        }
    }
}

impl VisualizerTap {
    pub(crate) fn set_active(&self, is_active: bool) {
        self.is_active.store(is_active, Ordering::Relaxed);
        if !is_active {
            let mut history = self.history.lock().unwrap_or_else(|e| e.into_inner());
            history.samples.clear();
            history.last_push = None;
        }
    }

    pub(crate) fn set_output_lead(&self, lead: Duration) {
        let micros = u64::try_from(lead.as_micros()).unwrap_or(u64::MAX);
        self.output_lead_micros.store(micros, Ordering::Relaxed);
    }

    // Runs on the audio thread, which must never wait on a reader: a busy history drops this block.
    fn push(&self, frames: &[f32], sample_rate: u32, now: Instant) {
        let mut history = match self.history.try_lock() {
            Ok(history) => history,
            Err(TryLockError::Poisoned(e)) => e.into_inner(),
            Err(TryLockError::WouldBlock) => return,
        };
        if history.sample_rate != sample_rate {
            history.samples.clear();
            history.sample_rate = sample_rate;
        }
        history.samples.extend(frames);
        let excess = history.samples.len().saturating_sub(HISTORY_LEN);
        history.samples.drain(..excess);
        history.last_push = Some(now);
    }

    /// The window the speakers are playing now: the newest samples are still in the output buffer.
    /// Returns the rate the samples reach the speakers at, which playback speed scales.
    fn heard_window(&self, now: Instant, speed: f32) -> Option<(Vec<f32>, f32)> {
        let history = self.history.lock().unwrap_or_else(|e| e.into_inner());
        let last_push = history.last_push?;
        let since_push = now.saturating_duration_since(last_push);
        if since_push > STALE_AFTER {
            return None;
        }
        let heard_rate = history.sample_rate as f32 * speed;
        let lead = Duration::from_micros(self.output_lead_micros.load(Ordering::Relaxed));
        let end = heard_end(history.samples.len(), heard_rate as f64, since_push, lead);
        let start = end.saturating_sub(WINDOW_LEN);
        let mut window = vec![0.0; WINDOW_LEN - (end - start)];
        window.extend(history.samples.range(start..end));
        Some((window, heard_rate))
    }

    fn levels(&self, band_count: usize, speed: f32, now: Instant) -> Vec<f32> {
        let band_count = band_count.clamp(1, MAX_BAND_COUNT);
        let Some((window, heard_rate)) = self.heard_window(now, speed) else {
            return vec![0.0; band_count];
        };
        let mut analyzer = self.analyzer.lock().unwrap_or_else(|e| e.into_inner());
        let magnitudes = analyzer
            .get_or_insert_with(Analyzer::new)
            .magnitudes(&window);
        band_levels(&magnitudes, heard_rate, band_count)
    }
}

/// Index one past the sample reaching the speakers, given `len` samples pulled so far,
/// the source samples the speakers consume per second and how far the output buffer trails.
fn heard_end(len: usize, heard_rate: f64, since_push: Duration, output_lead: Duration) -> usize {
    let lead = heard_rate * output_lead.as_secs_f64();
    let played_since = heard_rate * since_push.as_secs_f64();
    let behind = (lead - played_since).max(0.0) as usize;
    len.saturating_sub(behind)
}

fn hann_window(len: usize) -> Vec<f32> {
    let denominator = (len - 1) as f32;
    (0..len)
        .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / denominator).cos())
        .collect()
}

/// Log-spaced band levels in 0..=1 from linear bin amplitudes (bin `k` sits at `k * rate / fft_len`).
fn band_levels(magnitudes: &[f32], sample_rate: f32, band_count: usize) -> Vec<f32> {
    let fft_len = (magnitudes.len().saturating_sub(1) * 2).max(1);
    let bin_hz = sample_rate / fft_len as f32;
    let highest = HIGHEST_HZ.min(sample_rate / 2.0);
    let ratio = (highest / LOWEST_HZ).max(1.0).powf(1.0 / band_count as f32);
    (0..band_count)
        .map(|band| {
            let low_hz = LOWEST_HZ * ratio.powi(band as i32);
            let high_hz = low_hz * ratio;
            let center_hz = (low_hz * high_hz).sqrt();
            let amplitude = band_amplitude(magnitudes, low_hz / bin_hz, high_hz / bin_hz);
            let tilt = TILT_DB_PER_OCTAVE * (center_hz / TILT_PIVOT_HZ).log2();
            let decibels = 20.0 * amplitude.max(1e-9).log10() + tilt;
            ((decibels - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0)
        })
        .collect()
}

/// RMS of the bins in `[low, high)`, steadier than the loudest one; a band narrower than one bin
/// reads between its two neighbours.
fn band_amplitude(magnitudes: &[f32], low: f32, high: f32) -> f32 {
    let first = low.ceil() as usize;
    let last = (high.ceil() as usize).min(magnitudes.len());
    if first < last {
        let bins = &magnitudes[first..last];
        let power: f32 = bins.iter().map(|m| m * m).sum();
        return (power / bins.len() as f32).sqrt();
    }
    let center = (low + high) / 2.0;
    let below = center.floor() as usize;
    let fraction = center - below as f32;
    let at = |i: usize| magnitudes.get(i).copied().unwrap_or(0.0);
    at(below) * (1.0 - fraction) + at(below + 1) * fraction
}

/// Passes samples through untouched, copying a mono mix to `tap` while a visualizer is showing.
pub(crate) struct Tapped<S> {
    input: S,
    tap: Arc<VisualizerTap>,
    frame_sum: f32,
    frame_position: u16,
    pending: Vec<f32>,
}

impl<S: Source> Tapped<S> {
    pub(crate) fn new(input: S, tap: Arc<VisualizerTap>) -> Self {
        Self {
            input,
            tap,
            frame_sum: 0.0,
            frame_position: 0,
            pending: Vec::with_capacity(PUSH_BLOCK),
        }
    }

    fn record(&mut self, sample: Sample) {
        let channels = self.input.channels().get();
        self.frame_sum += sample;
        self.frame_position += 1;
        if self.frame_position < channels {
            return;
        }
        self.pending.push(self.frame_sum / channels as f32);
        self.frame_sum = 0.0;
        self.frame_position = 0;
        if self.pending.len() >= PUSH_BLOCK {
            self.tap.push(
                &self.pending,
                self.input.sample_rate().get(),
                Instant::now(),
            );
            self.pending.clear();
        }
    }
}

impl<S: Source> Iterator for Tapped<S> {
    type Item = Sample;

    fn next(&mut self) -> Option<Sample> {
        let sample = self.input.next()?;
        if self.tap.is_active.load(Ordering::Relaxed) {
            self.record(sample);
        } else if !self.pending.is_empty() || self.frame_position != 0 {
            self.pending.clear();
            self.frame_sum = 0.0;
            self.frame_position = 0;
        }
        Some(sample)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.input.size_hint()
    }
}

impl<S: Source> Source for Tapped<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.input.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.input.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.input.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)
    }
}

#[tauri::command]
pub fn audio_visualizer_set_active(state: tauri::State<'_, AudioState>, active: bool) {
    state.visualizer.set_active(active);
}

// Off the main thread: called every animation frame, and each call runs an FFT.
#[tauri::command(async)]
pub fn audio_visualizer_levels(state: tauri::State<'_, AudioState>, band_count: usize) -> Vec<f32> {
    let speed = *state.speed.lock().unwrap_or_else(|e| e.into_inner());
    state.visualizer.levels(band_count, speed, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use rodio::nz;

    const RATE: u32 = 44_100;
    const LEAD: Duration = Duration::from_millis(OUTPUT_BUFFER_MS as u64);

    fn sine(hz: f32, amplitude: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| amplitude * (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin())
            .collect()
    }

    fn band_holding(hz: f32, band_count: usize) -> usize {
        let ratio = (HIGHEST_HZ / LOWEST_HZ).powf(1.0 / band_count as f32);
        ((hz / LOWEST_HZ).ln() / ratio.ln()).floor() as usize
    }

    fn levels_of(samples: &[f32], band_count: usize) -> Vec<f32> {
        levels_at_speed(samples, band_count, 1.0)
    }

    fn levels_at_speed(samples: &[f32], band_count: usize, speed: f32) -> Vec<f32> {
        let tap = VisualizerTap::default();
        tap.set_active(true);
        let pushed_at = Instant::now();
        tap.push(samples, RATE, pushed_at);
        tap.levels(
            band_count,
            speed,
            pushed_at + Duration::from_millis(OUTPUT_BUFFER_MS as u64),
        )
    }

    fn loudest(levels: &[f32]) -> usize {
        levels
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(i, _)| i)
            .unwrap()
    }

    #[test]
    fn a_tone_peaks_in_the_band_holding_its_pitch() {
        for hz in [440.0, 3_000.0, 9_000.0] {
            let levels = levels_of(&sine(hz, 0.5, HISTORY_LEN), 48);
            assert_eq!(loudest(&levels), band_holding(hz, 48), "{hz} Hz");
        }
    }

    #[test]
    fn a_tone_played_at_double_speed_peaks_an_octave_up() {
        let levels = levels_at_speed(&sine(440.0, 0.5, HISTORY_LEN), 48, 2.0);
        assert_eq!(loudest(&levels), band_holding(880.0, 48));
    }

    #[test]
    fn a_bass_tone_peaks_within_one_band_of_its_pitch() {
        // Bass bands are narrower than one 21 Hz bin, so a tone can't be placed more finely.
        let levels = levels_of(&sine(80.0, 0.5, HISTORY_LEN), 48);
        assert!(loudest(&levels).abs_diff(band_holding(80.0, 48)) <= 1);
    }

    #[test]
    fn a_louder_tone_draws_a_taller_bar() {
        let quiet = levels_of(&sine(440.0, 0.05, HISTORY_LEN), 48);
        let loud = levels_of(&sine(440.0, 0.5, HISTORY_LEN), 48);
        let band = band_holding(440.0, 48);
        assert!(loud[band] > quiet[band] + 0.2);
        assert!(loud[band] <= 1.0);
    }

    #[test]
    fn silence_draws_nothing() {
        assert!(levels_of(&vec![0.0; HISTORY_LEN], 48)
            .iter()
            .all(|&l| l == 0.0));
    }

    #[test]
    fn levels_fall_to_zero_once_samples_stop_arriving() {
        let tap = VisualizerTap::default();
        tap.set_active(true);
        let pushed_at = Instant::now();
        tap.push(&sine(440.0, 0.5, HISTORY_LEN), RATE, pushed_at);

        assert!(tap.levels(48, 1.0, pushed_at).iter().any(|&l| l > 0.0));
        let later = pushed_at + STALE_AFTER + Duration::from_millis(1);
        assert!(tap.levels(48, 1.0, later).iter().all(|&l| l == 0.0));
    }

    #[test]
    fn band_count_is_clamped_to_a_sane_range() {
        assert_eq!(levels_of(&[], 0).len(), 1);
        assert_eq!(levels_of(&[], 10_000).len(), MAX_BAND_COUNT);
    }

    #[test]
    fn the_heard_sample_trails_the_newest_by_the_output_buffer() {
        let rate = RATE as f64;
        assert_eq!(
            heard_end(10_000, rate, Duration::ZERO, LEAD),
            10_000 - 4_410
        );
        assert_eq!(
            heard_end(10_000, rate, Duration::from_millis(50), LEAD),
            10_000 - 2_205
        );
        assert_eq!(
            heard_end(10_000, rate, Duration::from_millis(200), LEAD),
            10_000
        );
        assert_eq!(heard_end(100, rate, Duration::ZERO, LEAD), 0);
    }

    #[test]
    fn the_heard_sample_trails_by_the_buffer_the_stream_got() {
        let rate = RATE as f64;
        assert_eq!(
            heard_end(10_000, rate, Duration::ZERO, Duration::from_millis(50)),
            10_000 - 2_205
        );
    }

    #[test]
    fn a_tap_trails_by_the_lead_it_was_given() {
        let samples = sine(1_000.0, 0.5, 20_000);
        let pushed_at = Instant::now();
        let shorter = VisualizerTap::default();
        shorter.set_active(true);
        shorter.set_output_lead(Duration::from_millis(50));
        shorter.push(&samples, RATE, pushed_at);
        let default_lead = VisualizerTap::default();
        default_lead.set_active(true);
        default_lead.push(&samples, RATE, pushed_at);

        let (shorter_window, _) = shorter.heard_window(pushed_at, 1.0).expect("fresh push");
        let (default_window, _) = default_lead
            .heard_window(pushed_at, 1.0)
            .expect("fresh push");

        assert_eq!(
            shorter_window.last(),
            samples.get(samples.len() - 2_205 - 1)
        );
        assert_eq!(
            default_window.last(),
            samples.get(samples.len() - 4_410 - 1)
        );
    }

    #[test]
    fn faster_playback_drains_the_output_buffer_faster() {
        assert_eq!(
            heard_end(20_000, RATE as f64 * 2.0, Duration::ZERO, LEAD),
            20_000 - 8_820
        );
        assert_eq!(
            heard_end(20_000, RATE as f64 * 2.0, Duration::from_millis(50), LEAD),
            20_000 - 4_410
        );
    }

    #[test]
    fn the_window_ends_at_the_heard_sample() {
        let tap = VisualizerTap::default();
        tap.set_active(true);
        let samples: Vec<f32> = (0..HISTORY_LEN).map(|i| i as f32).collect();
        let pushed_at = Instant::now();
        tap.push(&samples, RATE, pushed_at);

        let (window, _) = tap.heard_window(pushed_at, 1.0).unwrap();
        assert_eq!(window.len(), WINDOW_LEN);
        assert_eq!(*window.last().unwrap(), (HISTORY_LEN - 4_410 - 1) as f32);
    }

    #[test]
    fn history_keeps_only_the_newest_samples() {
        let tap = VisualizerTap::default();
        let samples: Vec<f32> = (0..HISTORY_LEN + 100).map(|i| i as f32).collect();
        tap.push(&samples, RATE, Instant::now());

        let history = tap.history.lock().unwrap();
        assert_eq!(history.samples.len(), HISTORY_LEN);
        assert_eq!(history.samples[0], 100.0);
    }

    #[test]
    fn tapping_passes_every_sample_through_unchanged() {
        let samples: Vec<f32> = (0..1_000).map(|i| (i as f32 / 1_000.0) - 0.5).collect();
        let tap = Arc::new(VisualizerTap::default());
        tap.set_active(true);
        let source = SamplesBuffer::new(nz!(2), nz!(44_100), samples.clone());

        let out: Vec<f32> = Tapped::new(source, tap).collect();
        assert_eq!(out, samples);
    }

    #[test]
    fn tapping_records_a_mono_mix_while_active() {
        let mut samples = Vec::new();
        for _ in 0..PUSH_BLOCK {
            samples.extend([0.2, 0.6]);
        }
        let tap = Arc::new(VisualizerTap::default());
        tap.set_active(true);
        let source = SamplesBuffer::new(nz!(2), nz!(48_000), samples);

        Tapped::new(source, Arc::clone(&tap)).for_each(drop);
        let history = tap.history.lock().unwrap();
        assert_eq!(history.samples.len(), PUSH_BLOCK);
        assert!(history.samples.iter().all(|&s| (s - 0.4).abs() < 1e-6));
        assert_eq!(history.sample_rate, 48_000);
    }

    #[test]
    fn tapping_records_nothing_while_inactive() {
        let tap = Arc::new(VisualizerTap::default());
        let source = SamplesBuffer::new(nz!(1), nz!(44_100), vec![0.5; PUSH_BLOCK * 4]);

        Tapped::new(source, Arc::clone(&tap)).for_each(drop);
        assert!(tap.history.lock().unwrap().samples.is_empty());
    }

    #[test]
    fn deactivating_forgets_what_was_heard() {
        let tap = VisualizerTap::default();
        tap.set_active(true);
        tap.push(&[0.5; 100], RATE, Instant::now());
        tap.set_active(false);
        tap.set_active(true);

        assert!(tap.heard_window(Instant::now(), 1.0).is_none());
    }
}
