import type { StoreApi } from "zustand";
import type { DlnaRenderer } from "../../../clients/dlna";

export interface CurrentTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  coverArtUrl?: string | null;
  artworkRef?: string | null;
  album?: string | null;
  albumId?: string | null;
  replayGain?: {
    trackGain?: number | null;
    trackPeak?: number | null;
    albumGain?: number | null;
    albumPeak?: number | null;
  } | null;
}

/**
 * A playback failure the UI can offer a specific action for. Carried on the error itself
 * rather than beside it, so a writer that names a message cannot leave a stale cause behind.
 */
export type PlaybackErrorCause = "stale-track-id";

export interface PlaybackError {
  message: string;
  cause: PlaybackErrorCause | null;
}

export function plainError(message: string): PlaybackError {
  return { message, cause: null };
}

export type ReplayGainMode = "off" | "track" | "album";

export type RepeatMode = "off" | "repeat-all" | "repeat-one";

// Both player surfaces and the keyboard shortcut have to agree on when "next" does nothing,
// otherwise the button greys out on a track the shortcut will happily skip. Repeat-all wraps,
// and radio-on-queue-end starts a new session off the last track, so neither is a dead end.
export function isNextDisabled(
  repeat: RepeatMode,
  queueIndex: number,
  queueLength: number,
  radioOnQueueEnd: boolean
): boolean {
  return repeat === "off" && !radioOnQueueEnd && queueIndex >= queueLength - 1;
}

export function repeatModeLabel(repeat: RepeatMode): string {
  return repeat === "off" ? "Repeat off" : repeat === "repeat-all" ? "Repeat all" : "Repeat one";
}

export type RadioMode =
  | "curated"
  | "same-genre"
  | "similar-artists"
  | "same-artist"
  | "same-album"
  | "era"
  | "loved"
  | "random";

// What starting a radio does to the queue: throw it away, or keep it and let radio follow it.
export type RadioStartAction = "replace" | "queue_last";

export interface RadioStartRequest {
  tracks: CurrentTrack[];
  streamUrlFor: (t: CurrentTrack) => string;
  // Defaults to the first of `tracks`. A genre play queues many tracks but seeds from one;
  // radio started from the playing track queues nothing and passes only the seed.
  seed?: CurrentTrack;
  mode?: RadioMode;
  label?: string;
}

export const RADIO_MODES: { mode: RadioMode; label: string }[] = [
  { mode: "curated",          label: "Curated" },
  { mode: "same-genre",       label: "Same Genre" },
  { mode: "similar-artists",  label: "Similar Artists" },
  { mode: "same-artist",      label: "Same Artist" },
  { mode: "same-album",       label: "Same Album" },
  { mode: "era",              label: "Same Era" },
  { mode: "loved",            label: "Loved Tracks" },
  { mode: "random",           label: "Random" },
];

export interface QueueSnapshot {
  queue: CurrentTrack[];
  queueIndex: number;
  shuffleOrder: number[];
  isShuffled: boolean;
  currentTrack: CurrentTrack | null;
}

export interface PlayerState {
  currentTrack: CurrentTrack | null;
  streamUrl: string | null;
  isPlaying: boolean;
  // "A start request is in flight." On the local target audio_play returns as soon as it has
  // spawned its download thread, so this is only the IPC round trip and lasts a few ms. It gates
  // the transport buttons; it is not a signal that audio is being fetched. Use isBuffering for that.
  isLoading: boolean;
  // "Playback has been asked for but no sound is coming out yet." Spans the real wait: HTTP
  // connect, first bytes, format probing. Cleared by the audio-format event (emitted the instant
  // the sink is appended) or by the position ticker seeing the position move off zero.
  isBuffering: boolean;
  error: PlaybackError | null;
  elapsed: number;
  volume: number;
  repeat: RepeatMode;
  isShuffled: boolean;
  shuffleOrder: number[];
  queue: CurrentTrack[];
  queueIndex: number;
  streamUrlFor: ((track: CurrentTrack) => string) | null;
  playStartedAt: number;
  radioActive: boolean;
  radioSeed: CurrentTrack | null;
  radioMode: RadioMode;
  radioLabel: string | null;
  radioSimilarityScale: number;

  isQueueOpen: boolean;
  accentColor: string | null;
  waveformPeaks: number[] | null;

  sleepTimerEndsAt: number | null;
  sleepTimerMinutes: number | null;
  sleepTimerEndOfTrack: boolean;
  setSleepTimer: (preset: number | "end-of-track") => void;
  clearSleepTimer: () => void;

  speed: number;
  pauseFadeMs: number;
  consumeMode: boolean;
  consumeOnSkip: boolean;
  gapless: boolean;
  radioOnQueueEnd: boolean;
  audioFormat: { sampleRate: number; channels: number; codec: string } | null;

  replayGainMode: ReplayGainMode;
  replayGainPreAmp: number;
  replayGainFallbackGain: number;
  setReplayGainMode: (mode: ReplayGainMode) => Promise<void>;
  setReplayGainPreAmp: (db: number) => Promise<void>;
  setReplayGainFallbackGain: (db: number) => Promise<void>;

  castDevice: DlnaRenderer | null;
  availableRenderers: DlnaRenderer[];
  isScanningRenderers: boolean;
  rendererScanError: string | null;
  scanRenderers: () => Promise<void>;
  setCastDevice: (renderer: DlnaRenderer | null) => Promise<void>;

  play: (track: CurrentTrack, streamUrl: string) => Promise<void>;
  playQueue: (tracks: CurrentTrack[], streamUrlFor: (t: CurrentTrack) => string, startIndex?: number) => Promise<void>;
  restoreQueue: (tracks: CurrentTrack[], streamUrlFor: (t: CurrentTrack) => string, position: number) => void;
  next: (fromNaturalEnd?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  // Re-runs the current track from the start after a playback failure, with a fresh retry budget.
  retryCurrent: () => void;
  applyTrackIdRemap: (remaps: readonly { oldId: string; newId: string }[]) => boolean;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  toggleRepeat: () => Promise<void>;
  toggleShuffle: () => void;
  setStreamUrlFor: (fn: (t: CurrentTrack) => string) => void;
  setRadioActive: (active: boolean) => void;
  startRadio: (seed: CurrentTrack, mode?: RadioMode, label?: string) => void;
  startRadioFrom: (action: RadioStartAction, request: RadioStartRequest) => Promise<void>;
  setRadioMode: (mode: RadioMode) => void;
  setRadioSimilarityScale: (scale: number) => void;
  toggleConsumeMode: () => Promise<void>;
  toggleConsumeOnSkip: () => Promise<void>;
  toggleGapless: () => Promise<void>;
  toggleRadioOnQueueEnd: () => Promise<void>;
  loadSettings: () => Promise<void>;
  addToQueue: (track: CurrentTrack, streamUrlFn: (t: CurrentTrack) => string) => void;
  playNext: (track: CurrentTrack, streamUrlFn: (t: CurrentTrack) => string) => void;
  addManyToQueue: (tracks: CurrentTrack[], streamUrlFn: (t: CurrentTrack) => string) => void;
  playNextMany: (tracks: CurrentTrack[], streamUrlFn: (t: CurrentTrack) => string) => void;
  toggleQueue: () => void;
  removeFromQueue: (position: number) => Promise<void>;
  removeManyFromQueue: (positions: number[]) => Promise<void>;
  clearQueue: () => void;
  setAccentColor: (color: string | null) => void;
  moveQueueItem: (from: number, to: number) => void;
  playFromQueueIndex: (position: number) => Promise<void>;
  setWaveformPeaks: (peaks: number[] | null) => void;
  setPauseFadeMs: (ms: number) => Promise<void>;
  maxQueueSize: number;
  setMaxQueueSize: (n: number) => Promise<void>;
}

export type PlayerSet = StoreApi<PlayerState>["setState"];
export type PlayerGet = StoreApi<PlayerState>["getState"];
