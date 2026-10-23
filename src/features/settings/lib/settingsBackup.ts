import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../../db";
import { refreshAllSettings, storeSetting } from "../../../hooks/useSetting";
import { usePlayerStore } from "../../playback/store/player";

// Session state and per-server caches, not preferences: restoring them from an older file
// would bring back a stale queue or radio, or rerun the genre tree carry.
const STATE_KEYS = new Set([
  "queue_state",
  "radio_active",
  "radio_seed",
  "radio_mode",
  "radio_label",
  "genre_tree_version",
]);
const STATE_KEY_PREFIXES = ["server."];
// Left behind by builds that kept the key here; a backup is a plain file, and keys live in the keychain.
const LEGACY_SECRET_KEYS = new Set(["lastfm.api_key"]);

function isPreference(key: string): boolean {
  return (
    !STATE_KEYS.has(key) && !LEGACY_SECRET_KEYS.has(key) && !STATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export async function readSettingsBackup(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings ORDER BY key");
  return JSON.stringify(
    Object.fromEntries(rows.filter((r) => isPreference(r.key)).map((r) => [r.key, r.value])),
    null,
    2,
  );
}

export async function restoreSettingsBackup(text: string): Promise<void> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("This file is not a Canon settings backup.");
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && isPreference(key)) {
      await storeSetting(key, value);
    }
  }
}

/** Resolves to the saved path, or null when the save dialog was cancelled. */
export async function exportSettingsFile(): Promise<string | null> {
  return invoke<string | null>("save_settings_backup", {
    contents: await readSettingsBackup(),
    fileName: `canon-settings-${new Date().toISOString().slice(0, 10)}.json`,
  });
}

// For a screen that stays open: the player read its settings once at startup, so it needs the
// imported ones handed over too. A caller that reloads the window wants restoreSettingsBackup.
export async function importSettingsFile(file: File): Promise<void> {
  await restoreSettingsBackup(await file.text());
  await refreshAllSettings();
  await usePlayerStore.getState().loadSettings();
}
