import { getDb } from "../../../db";

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

function isPreference(key: string): boolean {
  return !STATE_KEYS.has(key) && !STATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
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
  const db = await getDb();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && isPreference(key)) {
      await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
  }
}

export async function exportSettingsFile(): Promise<void> {
  const blob = new Blob([await readSettingsBackup()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `canon-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSettingsFile(file: File): Promise<void> {
  await restoreSettingsBackup(await file.text());
}
