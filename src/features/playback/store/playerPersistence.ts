import { getDb } from "../../../db";
import { runtime } from "./playerRuntime";
import type { PlayerGet, QueueSnapshot } from "./playerTypes";

export function createPlayerPersistence(get: PlayerGet) {
  async function persistRadioState() {
    try {
      const { radioActive, radioSeed, radioMode, radioLabel, radioSimilarityScale } = get();
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_active', ?)",
        [radioActive ? "1" : "0"]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_seed', ?)",
        [radioSeed ? JSON.stringify(radioSeed) : ""]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_mode', ?)",
        [radioMode]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_label', ?)",
        [radioLabel ?? ""]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio.similarity_scale', ?)",
        [String(radioSimilarityScale)]
      );
    } catch (e) {
      console.error("Failed to persist radio state:", e);
    }
  }

  async function persistQueueStateNow() {
    try {
      const { queue, queueIndex, shuffleOrder, isShuffled, currentTrack } = get();
      const snapshot: QueueSnapshot = { queue, queueIndex, shuffleOrder, isShuffled, currentTrack };
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_state', ?)",
        [JSON.stringify(snapshot)]
      );
    } catch (e) {
      console.error("Failed to persist queue state:", e);
    }
  }

  function persistQueueState() {
    // Every queue mutation funnels through here, so this is the one place that sees them all.
    // The ticker's hand-off guard reads it to notice that the successor may have changed.
    runtime.queueRevision++;
    if (runtime.queuePersistTimer) clearTimeout(runtime.queuePersistTimer);
    runtime.queuePersistTimer = setTimeout(() => {
      runtime.queuePersistTimer = null;
      void persistQueueStateNow();
    }, 500);
  }

  async function persistVolumeNow(rawVolume: number) {
    try {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('volume', ?), ('player.pre_mute_volume', ?)",
        [String(rawVolume), String(runtime.preMuteVolume)]
      );
    } catch (e) {
      console.error("Failed to persist volume:", e);
    }
  }

  function persistVolume(rawVolume: number) {
    if (runtime.volumePersistTimer) clearTimeout(runtime.volumePersistTimer);
    runtime.volumePersistTimer = setTimeout(() => {
      runtime.volumePersistTimer = null;
      void persistVolumeNow(rawVolume);
    }, 500);
  }

  // Flush the debounced writes on quit so a skip/shuffle/volume change right before close
  // isn't lost.
  window.addEventListener("beforeunload", () => {
    if (runtime.queuePersistTimer) {
      clearTimeout(runtime.queuePersistTimer);
      runtime.queuePersistTimer = null;
      void persistQueueStateNow();
    }
    if (runtime.volumePersistTimer) {
      clearTimeout(runtime.volumePersistTimer);
      runtime.volumePersistTimer = null;
      void persistVolumeNow(get().volume);
    }
  });

  return { persistRadioState, persistQueueState, persistVolume };
}

export type PlayerPersistence = ReturnType<typeof createPlayerPersistence>;
