import { getDb } from "../db";

export async function exportSettingsFile(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings");
  const json = JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.value])), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `canon-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSettingsFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const db = await getDb();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
  }
}
