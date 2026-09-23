import { LocalTarget, type PlaybackTarget } from "./playbackTarget";
import type { CurrentTrack } from "./playerTypes";

// Track ids with a waveform extraction currently running in Rust. Extraction writes to a
// single temp file per track id, so two concurrent runs for the same track would interleave
// their writes and produce a corrupt analysis. Also avoids downloading the same track twice
// when a preloaded track becomes the current one before its extraction finishes.
export const waveformInFlight = new Set<string>();

// Engine-side playback state shared by the store and its helper modules. Kept out of the store so
// writes to it never notify subscribers.
interface PlayerRuntime {
  // Deduplicates natural-end advances triggered by both the Rust event and the TS fallback.
  lastEndedTrackId: string | null;

  // True while a next track has been enqueued via audio_enqueue_next for gapless playback.
  // Suppresses the position-based fallback advance so it doesn't interrupt the gapless transition.
  gaplessActive: boolean;

  // What was actually handed to the audio engine for the gapless transition, and the queue
  // position it sat at when it was enqueued. The engine takes the source up to a fifth of a
  // track before the transition, so the queue can be edited in between; on `track-advanced`
  // this is the only record of which track the user is now hearing.
  // `wrapOrder` is set only when the hand-off is a repeat-all loop-back under shuffle: the new
  // order has to be built at enqueue time, because the enqueued track is resolved against it and
  // rodio cannot un-append. `track-advanced` adopts it rather than building a second, different
  // order that would not have the audible track at position 0.
  gaplessEnqueued: { track: CurrentTrack; position: number; wrapOrder?: number[] } | null;

  // Bumped by every queue mutation. The elapsed ticker keys its "already handed off the next
  // track" guard on this as well as the index, so an edit that changes the successor re-arms
  // the hand-off instead of being locked out for the rest of the track.
  queueRevision: number;

  // Cancels in-flight audio-error retry listener when a new track starts.
  cancelAudioError: (() => void) | null;
  // Fires if a track that was asked to play never produces a single sample. Rust emits audio-error
  // for a connection that fails outright, but a server that accepts the connection and then stalls
  // mid-body errors nowhere: the buffering indicator sweeps forever, and the stall watchdog cannot
  // help because it only arms once the position has advanced at least once.
  bufferDeadlineTimer: ReturnType<typeof setTimeout> | null;
  // Debounces rapid prev/next so only one HTTP fetch fires after the user stops skipping.
  navDebounceTimer: ReturnType<typeof setTimeout> | null;
  // Debounces local queue-state persistence so a burst of skips/shuffles against a
  // large (e.g. library-sized) queue coalesces into one JSON.stringify + SQLite write
  // instead of one per action.
  queuePersistTimer: ReturnType<typeof setTimeout> | null;

  // Track id whose successors have already been queued for waveform preloading. The preload is
  // triggered from the elapsed ticker, which restarts on every resume, so without this a pause and
  // resume would re-run the whole preload pass (three SQLite reads per candidate) for no reason.
  waveformPreloadedFor: string | null;

  // Bumped by every seek. The elapsed ticker samples this before awaiting getPosition() and drops
  // the result if it changed, because a poll issued just before a seek resolves just after it and
  // would otherwise write the pre-seek position back over the position the user asked for. That
  // showed up as the progress bar jumping backwards for one tick after every click-to-seek.
  seekGen: number;

  // Current ReplayGain linear amplitude multiplier. Updated on track change and mode change.
  // Stored outside the store so setVolume can access the latest value without a selector.
  currentReplayGainLinear: number;

  // Volume to restore on unmute. Lives outside the store (like currentReplayGainLinear above) so
  // every mute button (PlayerBar, NowPlayingView) shares one source of truth instead of drifting.
  // Updated by setVolume on every audible level, not only by toggleMute, so dragging the slider to
  // zero and then unmuting restores where the user actually was. Persisted alongside the volume
  // itself: without that, a mute held across a restart loads volume 0 with this back at its 1.0
  // default, and the first unmute jumps to full.
  preMuteVolume: number;

  // Debounces persistence of the volume. The slider fires onChange per 0.01 step (~100 events per
  // drag), the wheel handler fires per wheel tick, and a held ArrowUp repeats at ~30/s, so writing
  // on every call meant a SQLite round trip per event against the same WAL db the audio path uses.
  // The audible change stays immediate; only the write is deferred.
  volumePersistTimer: ReturnType<typeof setTimeout> | null;

  // Set when pause() is called while a track is still loading. playTrack's completion handler
  // unconditionally sets isPlaying, so without this the pause is silently overwritten: the engine
  // ends up paused while the UI claims to be playing, with the position frozen at 0 and the stall
  // watchdog unable to arm (it needs the position to have advanced at least once).
  pauseRequestedDuringLoad: boolean;

  // Active playback target, swapped when casting to a DLNA renderer.
  // Lives outside the store to avoid serialization; all state mutations go through store actions.
  activeTarget: PlaybackTarget;

  elapsedInterval: ReturnType<typeof setInterval> | null;
  cancelWaveform: (() => void) | null;
  sleepTimerTimeout: ReturnType<typeof setTimeout> | null;
  // Tracks whether the TS fallback already fired next() for the current track position.
  naturalEndFiredForIndex: number | null;
}

export const runtime: PlayerRuntime = {
  lastEndedTrackId: null,
  gaplessActive: false,
  gaplessEnqueued: null,
  queueRevision: 0,
  cancelAudioError: null,
  bufferDeadlineTimer: null,
  navDebounceTimer: null,
  queuePersistTimer: null,
  waveformPreloadedFor: null,
  seekGen: 0,
  currentReplayGainLinear: 1.0,
  preMuteVolume: 1.0,
  volumePersistTimer: null,
  pauseRequestedDuringLoad: false,
  activeTarget: new LocalTarget(),
  elapsedInterval: null,
  cancelWaveform: null,
  sleepTimerTimeout: null,
  naturalEndFiredForIndex: null,
};
