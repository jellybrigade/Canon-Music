import { create } from "zustand";
import { getDb } from "../../../db";
import { LocalTarget, DlnaTarget } from "./playbackTarget";
import { discoverRenderers } from "../../../clients/dlna";
import { buildShuffleOrder, resolveTrack } from "./queueOrder";
import { computeReplayGainLinear } from "./replayGain";
import { runtime } from "./playerRuntime";
import { createPlayerPersistence } from "./playerPersistence";
import { createPlayerWaveform } from "./playerWaveform";
import { createPlayerEngine } from "./playerEngine";
import { createQueueActions } from "./queueActions";
import { createSettingsActions } from "./playerSettings";
import { plainError, type CurrentTrack, type PlayerState, type RadioMode } from "./playerTypes";

const PREV_RESTART_THRESHOLD_S = 3;
// Timers stop during suspend while the deadline is wall-clock, so the sleep timer re-checks
// Date.now() at least this often instead of trusting one long timeout.
const SLEEP_TIMER_CHECK_MS = 15000;

export const usePlayerStore = create<PlayerState>((set, get) => {
  const persistence = createPlayerPersistence(get);
  const engine = createPlayerEngine(set, get, persistence, createPlayerWaveform(set, get));
  const { persistQueueState, persistRadioState, persistVolume } = persistence;
  const { clearBufferDeadline, startElapsedTimer, stopElapsedTimer, playTrack } = engine;

  return {
    currentTrack: null,
    streamUrl: null,
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    error: null,
    elapsed: 0,
    volume: 1,
    speed: 1,
    pauseFadeMs: 150,
    maxQueueSize: 100,
    repeat: "off",
    isShuffled: false,
    shuffleOrder: [],
    queue: [],
    queueIndex: 0,
    streamUrlFor: null,
    playStartedAt: 0,
    radioActive: false,
    radioSeed: null,
    radioMode: "curated",
    radioLabel: null,
    radioSimilarityScale: 0.5,
    isQueueOpen: false,
    accentColor: null,
    waveformPeaks: null,

    sleepTimerEndsAt: null,
    sleepTimerMinutes: null,
    sleepTimerEndOfTrack: false,
    consumeMode: false,
    consumeOnSkip: false,
    gapless: false,
    radioOnQueueEnd: false,
    audioFormat: null,

    replayGainMode: "off",
    replayGainPreAmp: 0,
    replayGainFallbackGain: -6,

    castDevice: null,
    availableRenderers: [],
    isScanningRenderers: false,
    rendererScanError: null,

    scanRenderers: async () => {
      set({ isScanningRenderers: true, rendererScanError: null });
      try {
        const renderers = await discoverRenderers(4000);
        set({ availableRenderers: renderers });
      } catch (e) {
        console.error("DLNA discovery failed:", e);
        set({ availableRenderers: [], rendererScanError: String(e) });
      } finally {
        set({ isScanningRenderers: false });
      }
    },

    setCastDevice: async (renderer) => {
      const { isPlaying, elapsed, streamUrl, currentTrack } = get();

      // Tear down old target and park playback.
      runtime.activeTarget.teardown();

      if (!renderer) {
        runtime.activeTarget = new LocalTarget();
        set({ castDevice: null });
        // Restore local playback at the parked position.
        if (currentTrack && streamUrl) {
          try {
            await runtime.activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
            if (elapsed > 0) await runtime.activeTarget.seek(elapsed);
            if (isPlaying) startElapsedTimer();
            // load() starts audio on every target. Writing isPlaying: false without telling
            // the target would leave a paused player audibly playing on the new one.
            if (!isPlaying) runtime.activeTarget.pause(0);
            // Back on the local engine, so the same rule as playTrack applies: load() has
            // returned but nothing has been fetched yet. audio-format or the ticker clears this.
            set({ isPlaying, isLoading: false, isBuffering: isPlaying });
          } catch (e) {
            set({ isPlaying: false, isLoading: false, isBuffering: false, error: plainError(String(e)) });
          }
        }
      } else {
        let castBitrate = 320;
        try {
          const db2 = await getDb();
          const rows2 = await db2.select<{ value: string }[]>(
            "SELECT value FROM settings WHERE key = 'cast.max_bitrate'", []
          );
          if (rows2[0]) castBitrate = parseInt(rows2[0].value, 10) || 320;
        } catch { /* use default */ }
        runtime.activeTarget = new DlnaTarget(renderer, () => {
          // Called by DlnaTarget when track ends on renderer.
          void get().next(true);
        }, castBitrate, (message) => {
          // The renderer stopped answering. Nothing else on the cast path surfaces this:
          // there is no audio-error event, and the target has stopped its own timers.
          set({ error: plainError(message), isPlaying: false, isBuffering: false });
          stopElapsedTimer();
        });
        set({ castDevice: renderer });
        // Resume on renderer at parked position.
        if (currentTrack && streamUrl) {
          try {
            set({ isLoading: true, isBuffering: true });
            await runtime.activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
            if (elapsed > 0) await runtime.activeTarget.seek(elapsed);
            if (isPlaying) startElapsedTimer();
            // avPlay ran inside load(), so a player that was paused has to be paused again
            // on the renderer, not just recorded as paused in the store.
            if (!isPlaying) runtime.activeTarget.pause(0);
            set({ isPlaying, isLoading: false, isBuffering: false });
          } catch (e) {
            set({ isPlaying: false, isLoading: false, isBuffering: false, error: plainError(String(e)) });
          }
        }
      }

      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('cast.device', ?)",
          [renderer ? JSON.stringify(renderer) : ""]
        );
      } catch { /* non-fatal */ }
    },

    setWaveformPeaks: (peaks) => {
      set({ waveformPeaks: peaks });
    },

    play: async (track, streamUrl) => {
      // A one-track queue still needs an order covering that track while shuffle is on. Leaving
      // it empty lets the queue-mutating writers that index shuffleOrder without normalising
      // first (removeFromQueue, moveQueueItem) read past the end of it. Same case playQueue
      // handles for its single-track input.
      const { isShuffled } = get();
      set({ queue: [track], queueIndex: 0, streamUrlFor: () => streamUrl, shuffleOrder: isShuffled ? [0] : [] });
      await playTrack(track, streamUrl);
      void persistQueueState();
    },

    playQueue: async (tracks, streamUrlFor, startIndex = 0) => {
      const { isShuffled, maxQueueSize, radioActive: hadRadio, radioSeed: hadSeed } = get();
      let workingTracks = tracks;
      let workingStart = startIndex;

      // Cap the queue instead of storing the whole (possibly library-sized) list:
      // keeps playback-state re-renders, persistence writes, and Up Next rendering
      // bounded regardless of source size. Window is centered on the clicked track
      // so skipping in either direction still has room to move.
      if (maxQueueSize > 0 && tracks.length > maxQueueSize) {
        const half = Math.floor(maxQueueSize / 2);
        let begin = Math.max(0, startIndex - half);
        let end = begin + maxQueueSize;
        if (end > tracks.length) {
          end = tracks.length;
          begin = Math.max(0, end - maxQueueSize);
        }
        workingTracks = tracks.slice(begin, end);
        workingStart = startIndex - begin;
      }

      let shuffleOrder: number[] = [];
      let position = workingStart;

      if (isShuffled && workingTracks.length > 1) {
        shuffleOrder = buildShuffleOrder(workingTracks.length, workingStart);
        position = 0;
      } else if (isShuffled && workingTracks.length === 1) {
        // A one-track shuffled queue still needs an order covering that track. Leaving it empty
        // lets a later addToQueue/playNext splice into [] and produce an order that is one short
        // and offset by one, which makes queue[0] unreachable. Reached by every "start radio"
        // entry point, which seeds playQueue with a single track and then appends to it.
        shuffleOrder = [0];
      }

      set({ queue: workingTracks, queueIndex: position, streamUrlFor, shuffleOrder, radioActive: false, radioSeed: null });
      const track = resolveTrack(workingTracks, shuffleOrder, isShuffled, position);
      if (track) await playTrack(track, streamUrlFor(track));
      void persistQueueState();
      // Only write radio state if this call actually cleared one. The "start radio" callers run
      // playQueue and startRadio back to back, and startRadio has already written the new state
      // by the time this resumes, so persisting again is five redundant SQLite executes.
      if (hadRadio || hadSeed) void persistRadioState();
    },

    setSleepTimer: (preset) => {
      if (runtime.sleepTimerTimeout) { clearTimeout(runtime.sleepTimerTimeout); runtime.sleepTimerTimeout = null; }
      if (preset === "end-of-track") {
        set({ sleepTimerEndOfTrack: true, sleepTimerEndsAt: null, sleepTimerMinutes: null });
      } else {
        const endsAt = Date.now() + preset * 60 * 1000;
        set({ sleepTimerEndsAt: endsAt, sleepTimerMinutes: preset, sleepTimerEndOfTrack: false });
        const check = () => {
          const remaining = endsAt - Date.now();
          if (remaining > 0) {
            runtime.sleepTimerTimeout = setTimeout(check, Math.min(remaining, SLEEP_TIMER_CHECK_MS));
            return;
          }
          runtime.sleepTimerTimeout = null;
          get().pause();
          get().clearSleepTimer();
        };
        check();
      }
    },

    clearSleepTimer: () => {
      if (runtime.sleepTimerTimeout) { clearTimeout(runtime.sleepTimerTimeout); runtime.sleepTimerTimeout = null; }
      set({ sleepTimerEndsAt: null, sleepTimerMinutes: null, sleepTimerEndOfTrack: false });
    },

    next: async (fromNaturalEnd = false) => {
      const { queue, queueIndex, streamUrlFor, repeat, isShuffled, shuffleOrder, consumeMode, consumeOnSkip } = get();
      if (queue.length === 0 || !streamUrlFor) return;

      // Deduplicate: both the Rust event and the TS fallback call next(true); only handle once.
      if (fromNaturalEnd) {
        const trackId = get().currentTrack?.id ?? null;
        if (trackId && trackId === runtime.lastEndedTrackId) return;
        runtime.lastEndedTrackId = trackId;
      }

      // An end-of-track sleep timer runs the same advance but lands paused, matching the gapless
      // path, which pauses at the start of the next track. The engine holds nothing after a
      // natural end, so the parked track has no stream URL and resume() loads it on demand.
      const parking = fromNaturalEnd && get().sleepTimerEndOfTrack;
      if (parking) {
        get().clearSleepTimer();
        stopElapsedTimer();
      }
      const land = async (track: CurrentTrack) => {
        if (!parking) {
          await playTrack(track, streamUrlFor(track), true);
          return;
        }
        set({ currentTrack: track, streamUrl: null, elapsed: 0, isPlaying: false, isLoading: false, isBuffering: false, error: null, waveformPeaks: null });
        // The other natural-end signal for the finished track is still coming, and the dedupe
        // above compares against the current track, which is now the parked one.
        runtime.lastEndedTrackId = track.id;
      };

      if (repeat === "repeat-one") {
        const track = resolveTrack(queue, shuffleOrder, isShuffled, queueIndex);
        if (track) await land(track);
        void persistQueueState();
        return;
      }

      // Consume mode: remove the just-played track from the queue on natural end or manual skip.
      // Shuffle not supported, queue indices would need a full remap.
      if (consumeMode && !isShuffled && (fromNaturalEnd || consumeOnSkip)) {
        const newQueue = queue.filter((_, i) => i !== queueIndex);
        if (newQueue.length === 0) {
          set({ queue: newQueue });
          get().stop();
        } else if (repeat === "repeat-all" && queueIndex >= newQueue.length) {
          set({ queue: newQueue, queueIndex: 0 });
          const t = newQueue[0] ?? null;
          if (t) void land(t);
        } else {
          const nextIdx = Math.min(queueIndex, newQueue.length - 1);
          set({ queue: newQueue, queueIndex: nextIdx });
          const t = newQueue[nextIdx] ?? null;
          if (t) void land(t);
        }
        void persistQueueState();
        return;
      }

      const nextPosition = queueIndex + 1;
      if (nextPosition < queue.length) {
        set({ queueIndex: nextPosition });
        const track = resolveTrack(queue, shuffleOrder, isShuffled, nextPosition);
        if (track) await land(track);
      } else if (repeat === "repeat-all") {
        // Re-shuffle on loop-back so each pass plays a different order. Unanchored (-1): the
        // previous pass has finished, so there is no playing track to keep at position 0, and
        // anchoring on queue index 0 made every single wrap open with queue[0].
        const newShuffleOrder = isShuffled && queue.length > 1
          ? buildShuffleOrder(queue.length, -1)
          : shuffleOrder;
        set({ queueIndex: 0, shuffleOrder: newShuffleOrder });
        const track = resolveTrack(queue, newShuffleOrder, isShuffled, 0);
        if (track) await land(track);
      } else if (parking) {
        const finished = get().currentTrack;
        if (finished) await land(finished);
      } else {
        if (get().radioOnQueueEnd) {
          const seed = get().currentTrack;
          if (seed) {
            runtime.activeTarget.stop();
            stopElapsedTimer();
            set({ isPlaying: false, isLoading: false, radioActive: true, radioSeed: seed });
          } else {
            get().stop();
          }
        } else {
          get().stop();
        }
      }
      void persistQueueState();
    },

    prev: async () => {
      const { queue, queueIndex, streamUrlFor, elapsed, isShuffled, shuffleOrder, error, currentTrack } = get();
      if (queue.length === 0 || !streamUrlFor) return;
      const restart = elapsed > PREV_RESTART_THRESHOLD_S;
      // Restarting the track the engine already holds is a seek, not a load. Going through
      // playTrack re-fetched and re-decoded the whole file just to get back to zero, so the
      // most common use of this button paid a network round trip and a buffering spinner for
      // something the sink can do instantly. This is what the button's own hold-to-restart
      // gesture already does. A failed track has no sink to seek, so that still reloads.
      if (restart && currentTrack && !error) {
        await get().seek(0);
        return;
      }
      const newPosition = restart ? queueIndex : Math.max(0, queueIndex - 1);
      set({ queueIndex: newPosition });
      const track = resolveTrack(queue, shuffleOrder, isShuffled, newPosition);
      if (track) void playTrack(track, streamUrlFor(track), true);
      void persistQueueState();
    },

    pause: () => {
      const { pauseFadeMs, currentTrack, isLoading } = get();
      if (!currentTrack) return;
      if (isLoading) runtime.pauseRequestedDuringLoad = true;
      runtime.activeTarget.pause(pauseFadeMs);
      stopElapsedTimer();
      set({ isPlaying: false });
    },

    resume: () => {
      const { pauseFadeMs, currentTrack, error, streamUrl } = get();
      // Nothing loaded (queue ran out, queue cleared, or stop()). Without this guard an
      // OS-level play command leaves isPlaying true with no audio and an elapsed ticker
      // polling a position that counts up against silence.
      if (!currentTrack) return;
      // The current track failed, so there is no sink to resume. Pressing play (or the media
      // key) means "try this again", which is what the Retry button does.
      if (error) {
        get().retryCurrent();
        return;
      }
      // A session restored from queue_state has a currentTrack but has never loaded anything
      // into the engine, so there is no sink to resume either. Resuming one anyway left the
      // store claiming to play with the position stuck at 0, which the stall watchdog cannot
      // recover from because it requires the position to have advanced at least once.
      if (!streamUrl) {
        get().retryCurrent();
        return;
      }
      runtime.pauseRequestedDuringLoad = false;
      runtime.activeTarget.resume(pauseFadeMs);
      startElapsedTimer();
      set({ isPlaying: true });
    },

    retryCurrent: () => {
      const { currentTrack, streamUrl, streamUrlFor } = get();
      if (!currentTrack) return;
      // Rebuild the URL where possible: a failure caused by an expired or rotated credential
      // would otherwise be retried against the same stale URL forever.
      const url = streamUrlFor ? streamUrlFor(currentTrack) : streamUrl;
      if (!url) return;
      void playTrack(currentTrack, url);
    },

    stop: () => {
      runtime.pauseRequestedDuringLoad = false;
      runtime.activeTarget.stop();
      stopElapsedTimer();
      clearBufferDeadline();
      runtime.cancelAudioError?.();
      runtime.cancelAudioError = null;
      set({
        currentTrack: null,
        streamUrl: null,
        isPlaying: false,
        isLoading: false,
        isBuffering: false,
        error: null,
        elapsed: 0,
        // queue, queueIndex, streamUrlFor preserved, accidental stop doesn't destroy queue
      });
      void persistQueueState();
    },

    setVolume: async (rawVolume: number) => {
      set({ volume: rawVolume });
      if (rawVolume > 0) runtime.preMuteVolume = rawVolume;
      const { replayGainMode, replayGainPreAmp, replayGainFallbackGain, currentTrack, castDevice } = get();
      runtime.currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
      await runtime.activeTarget.setVolume(rawVolume * Math.sqrt(runtime.currentReplayGainLinear));
      persistVolume(rawVolume);
    },

    toggleMute: async () => {
      const { volume, setVolume } = get();
      // setVolume keeps preMuteVolume at the last audible level, so this restores where the
      // user was whether they got to zero via this button or by dragging the slider down.
      await setVolume(volume > 0 ? 0 : runtime.preMuteVolume || 1);
    },

    seek: async (seconds: number) => {
      runtime.seekGen++;
      set({ elapsed: seconds });
      await runtime.activeTarget.seek(seconds);
    },

    setStreamUrlFor: (fn) => {
      set({ streamUrlFor: fn });
    },

    setRadioActive: (active: boolean) => {
      set({ radioActive: active, ...(!active ? { radioSeed: null, radioLabel: null } : {}) });
      void persistRadioState();
    },

    startRadio: (seed: CurrentTrack, mode?: RadioMode, label?: string) => {
      set({ radioActive: true, radioSeed: seed, ...(mode ? { radioMode: mode } : {}), radioLabel: label ?? null });
      void persistRadioState();
    },

    startRadioFrom: async (action, { tracks, streamUrlFor, seed, mode, label }) => {
      const radioSeed = seed ?? tracks[0];
      if (!radioSeed) return;
      if (tracks.length === 0) {
        // Seeded from the track already playing: nothing new to queue, and replacing must not
        // restart it, so the queue shrinks to that track alone.
        const { currentTrack, isShuffled } = get();
        if (action === "replace" && currentTrack) {
          set({ queue: [currentTrack], queueIndex: 0, shuffleOrder: isShuffled ? [0] : [] });
          void persistQueueState();
        }
      } else if (action === "replace") {
        await get().playQueue(tracks, streamUrlFor, 0);
      } else {
        const hadTrack = get().currentTrack !== null;
        const firstAppended = get().queue.length;
        get().addManyToQueue(tracks, streamUrlFor);
        if (!hadTrack) await get().playFromQueueIndex(Math.min(firstAppended, get().queue.length - 1));
      }
      get().startRadio(radioSeed, mode, label);
    },

    setRadioMode: (mode: RadioMode) => {
      set({ radioMode: mode });
      void persistRadioState();
    },

    setRadioSimilarityScale: (scale: number) => {
      set({ radioSimilarityScale: Math.max(0, Math.min(1, scale)) });
      void persistRadioState();
    },

    toggleQueue: () => {
      set((s) => ({ isQueueOpen: !s.isQueueOpen }));
    },

    setAccentColor: (color) => {
      set({ accentColor: color });
    },

    ...createQueueActions(set, get, engine, persistence),
    ...createSettingsActions(set, get, engine),
  };
});
