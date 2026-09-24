import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../../db";
import { DlnaTarget } from "./playbackTarget";
import type { DlnaRenderer } from "../../../clients/dlna";
import { isOwnedByServer } from "../../../lib/ids";
import { computeReplayGainLinear } from "./replayGain";
import { runtime } from "./playerRuntime";
import type { PlayerEngine } from "./playerEngine";
import {
  plainError,
  type CurrentTrack,
  type PlayerGet,
  type PlayerSet,
  type PlayerState,
  type QueueSnapshot,
  type RadioMode,
  type RepeatMode,
  type ReplayGainMode,
} from "./playerTypes";

type SettingsActions = Pick<
  PlayerState,
  | "toggleConsumeMode"
  | "toggleConsumeOnSkip"
  | "toggleGapless"
  | "toggleRadioOnQueueEnd"
  | "setSpeed"
  | "setMaxQueueSize"
  | "setPauseFadeMs"
  | "setReplayGainMode"
  | "setReplayGainPreAmp"
  | "setReplayGainFallbackGain"
  | "toggleRepeat"
  | "loadSettings"
>;

export function createSettingsActions(
  set: PlayerSet,
  get: PlayerGet,
  { stopElapsedTimer }: PlayerEngine
): SettingsActions {
  return {
    toggleConsumeMode: async () => {
      const next = !get().consumeMode;
      set({ consumeMode: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.consume_mode', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist consume mode:", e);
      }
    },

    toggleConsumeOnSkip: async () => {
      const next = !get().consumeOnSkip;
      set({ consumeOnSkip: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.consume_on_skip', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist consume on skip:", e);
      }
    },

    toggleGapless: async () => {
      const next = !get().gapless;
      set({ gapless: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.gapless', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist gapless:", e);
      }
    },

    toggleRadioOnQueueEnd: async () => {
      const next = !get().radioOnQueueEnd;
      set({ radioOnQueueEnd: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.radio_on_queue_end', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist radio_on_queue_end:", e);
      }
    },

    setSpeed: async (speed: number) => {
      const clamped = Math.max(0.5, Math.min(2.0, speed));
      set({ speed: clamped });
      await invoke("audio_set_speed", { speed: clamped });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.speed', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist speed:", e);
      }
    },

    setMaxQueueSize: async (n: number) => {
      const clamped = Math.max(1, Math.min(1000, Math.round(n)));
      set({ maxQueueSize: clamped });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.max_queue_size', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist max queue size:", e);
      }
    },

    setPauseFadeMs: async (ms: number) => {
      const clamped = Math.max(0, Math.min(2000, ms));
      set({ pauseFadeMs: clamped });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.pause_fade_ms', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist pause fade:", e);
      }
    },

    setReplayGainMode: async (mode) => {
      set({ replayGainMode: mode });
      const { volume, replayGainPreAmp, replayGainFallbackGain, currentTrack, castDevice } = get();
      runtime.currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, mode, replayGainPreAmp, replayGainFallbackGain);
      await runtime.activeTarget.setVolume(volume * Math.sqrt(runtime.currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.replay_gain_mode', ?)",
          [mode]
        );
      } catch (e) {
        console.error("Failed to persist replay_gain_mode:", e);
      }
    },

    setReplayGainPreAmp: async (db_val) => {
      const clamped = Math.max(-15, Math.min(15, db_val));
      set({ replayGainPreAmp: clamped });
      const { volume, replayGainMode, replayGainFallbackGain, currentTrack, castDevice } = get();
      runtime.currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, clamped, replayGainFallbackGain);
      await runtime.activeTarget.setVolume(volume * Math.sqrt(runtime.currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.replay_gain_pre_amp', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist replay_gain_pre_amp:", e);
      }
    },

    setReplayGainFallbackGain: async (db_val) => {
      const clamped = Math.max(-15, Math.min(15, db_val));
      set({ replayGainFallbackGain: clamped });
      const { volume, replayGainMode, replayGainPreAmp, currentTrack, castDevice } = get();
      runtime.currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, replayGainPreAmp, clamped);
      await runtime.activeTarget.setVolume(volume * Math.sqrt(runtime.currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.replay_gain_fallback_gain', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist replay_gain_fallback_gain:", e);
      }
    },

    toggleRepeat: async () => {
      const { repeat } = get();
      const next: RepeatMode =
        repeat === "off" ? "repeat-all" : repeat === "repeat-all" ? "repeat-one" : "off";
      set({ repeat: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('repeat', ?)",
          [next]
        );
      } catch (e) {
        console.error("Failed to persist repeat:", e);
      }
    },

    loadSettings: async () => {
      try {
        const db = await getDb();
        const rows = await db.select<{ key: string; value: string }[]>(
          "SELECT key, value FROM settings WHERE key IN ('volume', 'player.pre_mute_volume', 'repeat', 'queue_state', 'radio_active', 'radio_seed', 'radio_mode', 'radio_label', 'queue.restore_on_startup', 'player.speed', 'player.pause_fade_ms', 'player.consume_mode', 'player.consume_on_skip', 'player.gapless', 'player.radio_on_queue_end', 'player.show_waveform', 'cast.device', 'cast.max_bitrate', 'player.replay_gain_mode', 'player.replay_gain_pre_amp', 'player.replay_gain_fallback_gain', 'player.max_queue_size')",
          []
        );
        const restoreQueue = rows.find((r) => r.key === "queue.restore_on_startup")?.value === "true";
        let showWaveform = true;
        // The queue snapshot and the radio seed are global settings rows carrying
        // server-scoped track ids, so removing a server strands ids the mirror no longer
        // holds and every stripServerPrefix consumer throws the moment one is restored.
        // Only these two keys carry ids, so nothing else pays for the read.
        const carriesTrackIds = rows.some(
          (r) => (r.key === "queue_state" || r.key === "radio_seed") && r.value
        );
        const serverIds = carriesTrackIds
          ? (await db.select<{ id: string }[]>("SELECT id FROM servers", [])).map((r) => r.id)
          : [];
        let radioSeedStranded = false;
        for (const row of rows) {
          if (row.key === "volume") {
            const volume = parseFloat(row.value);
            if (!isNaN(volume)) {
              set({ volume });
              // Gain not yet loaded at this point; apply raw volume. Re-applied after all settings loaded.
              await invoke("audio_volume", { volume: volume ** 2 });
            }
          } else if (row.key === "player.pre_mute_volume") {
            // Restores the unmute level across a restart. Without it a session that quit while
            // muted loads volume 0 with preMuteVolume back at its 1.0 default, so the first
            // unmute jumps to full instead of returning to the level the user was using.
            const preMute = parseFloat(row.value);
            if (!isNaN(preMute) && preMute > 0) runtime.preMuteVolume = preMute;
          } else if (row.key === "repeat") {
            const valid: RepeatMode[] = ["off", "repeat-all", "repeat-one"];
            if (valid.includes(row.value as RepeatMode)) {
              set({ repeat: row.value as RepeatMode });
            }
          } else if (row.key === "queue_state" && restoreQueue) {
            try {
              const saved = JSON.parse(row.value) as QueueSnapshot;
              // All or nothing: a queue restored past the stranded entries leaves queueIndex
              // and shuffleOrder pointing at the holes they left.
              const owned = [...(saved.queue ?? []), ...(saved.currentTrack ? [saved.currentTrack] : [])]
                .every((t) => isOwnedByServer(t.id, serverIds));
              if (owned && Array.isArray(saved.queue) && saved.queue.length > 0 && get().currentTrack === null) {
                set({
                  queue: saved.queue,
                  queueIndex: saved.queueIndex ?? 0,
                  shuffleOrder: saved.shuffleOrder ?? [],
                  isShuffled: saved.isShuffled ?? false,
                  currentTrack: saved.currentTrack ?? null,
                });
              }
            } catch {
              // malformed snapshot, ignore
            }
          } else if (row.key === "radio_active") {
            set({ radioActive: row.value === "1" });
          } else if (row.key === "radio_seed") {
            if (row.value) {
              try {
                const seed = JSON.parse(row.value) as CurrentTrack;
                if (isOwnedByServer(seed.id, serverIds)) set({ radioSeed: seed });
                else radioSeedStranded = true;
              } catch {
                // malformed seed, ignore
              }
            }
          } else if (row.key === "radio_mode") {
            const VALID_MODES: RadioMode[] = ["curated", "same-genre", "similar-artists", "same-artist", "same-album", "era", "loved", "random"];
            if (VALID_MODES.includes(row.value as RadioMode)) {
              set({ radioMode: row.value as RadioMode });
            }
          } else if (row.key === "radio_label") {
            set({ radioLabel: row.value || null });
          } else if (row.key === "radio.similarity_scale") {
            const scale = parseFloat(row.value);
            if (!isNaN(scale)) set({ radioSimilarityScale: Math.max(0, Math.min(1, scale)) });
          } else if (row.key === "player.speed") {
            const speed = parseFloat(row.value);
            if (!isNaN(speed)) {
              const clamped = Math.max(0.5, Math.min(2.0, speed));
              set({ speed: clamped });
              void invoke("audio_set_speed", { speed: clamped });
            }
          } else if (row.key === "player.pause_fade_ms") {
            const ms = parseInt(row.value, 10);
            if (!isNaN(ms)) set({ pauseFadeMs: Math.max(0, Math.min(2000, ms)) });
          } else if (row.key === "player.max_queue_size") {
            const n = parseInt(row.value, 10);
            if (!isNaN(n)) set({ maxQueueSize: Math.max(1, Math.min(1000, n)) });
          } else if (row.key === "player.consume_mode") {
            set({ consumeMode: row.value === "true" });
          } else if (row.key === "player.consume_on_skip") {
            set({ consumeOnSkip: row.value === "true" });
          } else if (row.key === "player.gapless") {
            set({ gapless: row.value === "true" });
          } else if (row.key === "player.radio_on_queue_end") {
            set({ radioOnQueueEnd: row.value === "true" });
          } else if (row.key === "player.show_waveform") {
            showWaveform = row.value === "true";
          } else if (row.key === "player.replay_gain_mode") {
            const valid: ReplayGainMode[] = ["off", "track", "album"];
            if (valid.includes(row.value as ReplayGainMode)) set({ replayGainMode: row.value as ReplayGainMode });
          } else if (row.key === "player.replay_gain_pre_amp") {
            const v = parseFloat(row.value);
            if (!isNaN(v)) set({ replayGainPreAmp: Math.max(-15, Math.min(15, v)) });
          } else if (row.key === "player.replay_gain_fallback_gain") {
            const v = parseFloat(row.value);
            if (!isNaN(v)) set({ replayGainFallbackGain: Math.max(-15, Math.min(15, v)) });
          } else if (row.key === "cast.device" && row.value) {
            try {
              const savedRenderer = JSON.parse(row.value) as DlnaRenderer;
              const bitrateRow = rows.find((r2) => r2.key === "cast.max_bitrate");
              const savedBitrate = bitrateRow ? (parseInt(bitrateRow.value, 10) || 320) : 320;
              runtime.activeTarget = new DlnaTarget(
                savedRenderer,
                () => { void get().next(true); },
                savedBitrate,
                (message) => {
                  set({ error: plainError(message), isPlaying: false, isBuffering: false });
                  stopElapsedTimer();
                }
              );
              set({ castDevice: savedRenderer });
            } catch { /* malformed, ignore */ }
          }
        }
        // Decided after the loop: `radio_active` and `radio_label` are separate rows and
        // arrive in whatever order the read returns them, so a seed rejected mid-loop would
        // otherwise be followed by the row that turns radio back on without one.
        if (radioSeedStranded) set({ radioSeed: null, radioActive: false, radioLabel: null });
        // Load waveform from cache for the restored track, fetchWaveform is only
        // called from playTrack, so a session-restored track would show nothing until
        // the user navigated away and back.
        if (showWaveform) {
          const restoredTrack = get().currentTrack;
          if (restoredTrack) {
            type WRow = { peaks_json: string };
            const wrows = await db.select<WRow[]>(
              "SELECT peaks_json FROM waveform_cache WHERE track_id = ?",
              [restoredTrack.id]
            );
            if (wrows[0]) {
              try {
                const peaks = JSON.parse(wrows[0].peaks_json) as number[];
                const lastMeaningful = peaks.reduce((last, v, i) => (v > 0.01 ? i : last), -1);
                const coverage = peaks.length > 0 ? (lastMeaningful + 1) / peaks.length : 0;
                if (coverage >= 0.5 && get().currentTrack?.id === restoredTrack.id) {
                  set({ waveformPeaks: peaks });
                }
              } catch { /* malformed peaks, ignore */ }
            }
          }
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    },
  };
}
