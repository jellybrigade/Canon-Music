import { invoke } from "@tauri-apps/api/core";
import { runtime } from "./playerRuntime";

// For a setting changed after the next track was handed to the engine. Once playback has
// reached it the transition stands, and track-advanced follows it as before.
export async function withdrawGaplessHandOff(): Promise<void> {
  const enqueued = runtime.gaplessEnqueued;
  if (!enqueued) return;
  const isWithdrawn = await invoke<boolean>("audio_withdraw_next").catch(() => false);
  if (!isWithdrawn || runtime.gaplessEnqueued !== enqueued) return;
  runtime.gaplessActive = false;
  runtime.gaplessEnqueued = null;
}
