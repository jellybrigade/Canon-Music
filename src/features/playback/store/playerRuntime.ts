import { LocalTarget, type PlaybackTarget } from "./playbackTarget";
import type { CurrentTrack } from "./playerTypes";

// Single temp file per track id: concurrent extraction runs for the same id would corrupt it.
export const waveformInFlight = new Set<string>();

// Engine-side playback state shared by the store and its helpers, kept out of the store so
// writes never notify subscribers.
interface PlayerRuntime {
  // Dedupes natural-end advances from both the Rust event and the TS fallback.
  lastEndedTrackId: string | null;
  gaplessActive: boolean;
  // The only record of what's audible on `track-advanced`; wraps/wrapOrder carry the
  // repeat-all decision made at enqueue.
  gaplessEnqueued: { track: CurrentTrack; position: number; wraps: boolean; wrapOrder?: number[] } | null;
  // The elapsed ticker's hand-off guard keys on this too, so a successor-changing queue
  // edit re-arms instead of staying locked out for the rest of the track.
  queueRevision: number;
  cancelAudioError: (() => void) | null;
  // Covers a stalled connection: the stall watchdog only arms after position first advances.
  bufferDeadlineTimer: ReturnType<typeof setTimeout> | null;
  navDebounceTimer: ReturnType<typeof setTimeout> | null;
  queuePersistTimer: ReturnType<typeof setTimeout> | null;
  // Ticker restarts on every resume, so without this a pause/resume re-runs the whole
  // preload pass.
  waveformPreloadedFor: string | null;
  // Ticker drops a getPosition() result if this changed mid-await.
  seekGen: number;
  // Kept outside the store so setVolume reads it without a selector.
  currentReplayGainLinear: number;
  preMuteVolume: number;
  volumePersistTimer: ReturnType<typeof setTimeout> | null;
  // playTrack's completion handler unconditionally sets isPlaying, which would otherwise
  // overwrite a pause requested mid-load.
  pauseRequestedDuringLoad: boolean;
  // Kept outside the store to avoid serialization; mutations still go through store actions.
  activeTarget: PlaybackTarget;
  elapsedInterval: ReturnType<typeof setInterval> | null;
  cancelWaveform: (() => void) | null;
  sleepTimerTimeout: ReturnType<typeof setTimeout> | null;
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
